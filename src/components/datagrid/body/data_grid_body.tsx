/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import classNames from 'classnames';
import React, {
  forwardRef,
  FunctionComponent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GridChildComponentProps,
  VariableSizeGrid as Grid,
  VariableSizeGridProps,
} from 'react-window';
import tabbable from 'tabbable';
import {
  EuiMutationObserver,
  useMutationObserver,
} from '../../observer/mutation_observer';
import { useResizeObserver } from '../../observer/resize_observer';
import { DEFAULT_ROW_HEIGHT, RowHeightUtils } from '../row_height_utils';
import { EuiDataGridCell } from './data_grid_cell';
import {
  DataGridSortingContext,
  DataGridWrapperRowsContext,
} from '../data_grid_context';
import { defaultComparator } from '../data_grid_schema';
import { EuiDataGridFooterRow } from './data_grid_footer_row';
import { EuiDataGridHeaderRow } from './header';
import {
  DefaultColumnFormatter,
  providedPopoverContents,
} from './popover_utils';
import {
  EuiDataGridBodyProps,
  EuiDataGridInMemoryValues,
  EuiDataGridRowHeightsOptions,
  EuiDataGridRowManager,
  EuiDataGridSchemaDetector,
} from '../data_grid_types';
import { makeRowManager } from './data_grid_row_manager';
import { useForceRender } from '../../../services/hooks/useForceRender';
import { useUpdateEffect } from '../../../services';

export const VIRTUALIZED_CONTAINER_CLASS = 'euiDataGrid__virtualized';

export const Cell: FunctionComponent<GridChildComponentProps> = ({
  columnIndex,
  rowIndex: visibleRowIndex,
  style,
  data,
}) => {
  const {
    rowMap,
    rowOffset,
    leadingControlColumns,
    trailingControlColumns,
    columns,
    schema,
    popoverContents,
    columnWidths,
    defaultColumnWidth,
    renderCellValue,
    interactiveCellId,
    setRowHeight,
    schemaDetectors,
    rowHeightsOptions,
    rowHeightUtils,
    rowManager,
  } = data;

  const { headerRowHeight } = useContext(DataGridWrapperRowsContext);

  const offsetRowIndex = visibleRowIndex + rowOffset;

  const rowIndex = rowMap.hasOwnProperty(offsetRowIndex)
    ? rowMap[offsetRowIndex]
    : offsetRowIndex;

  let cellContent;

  const isFirstColumn = columnIndex === 0;
  const isLastColumn =
    columnIndex ===
    columns.length +
      leadingControlColumns.length +
      trailingControlColumns.length -
      1;
  const isStripableRow = visibleRowIndex % 2 !== 0;

  const isLeadingControlColumn = columnIndex < leadingControlColumns.length;
  const isTrailingControlColumn =
    columnIndex >= leadingControlColumns.length + columns.length;

  const dataColumnIndex = columnIndex - leadingControlColumns.length;
  const column = columns[dataColumnIndex];
  const columnId = column?.id;

  const transformClass = schemaDetectors.filter(
    (row: EuiDataGridSchemaDetector) => {
      return column?.schema
        ? column?.schema === row.type
        : columnId === row.type;
    }
  )[0];
  const textTransform = transformClass?.textTransform;

  const classes = classNames({
    'euiDataGridRowCell--stripe': isStripableRow,
    'euiDataGridRowCell--firstColumn': isFirstColumn,
    'euiDataGridRowCell--lastColumn': isLastColumn,
    'euiDataGridRowCell--controlColumn':
      isLeadingControlColumn || isTrailingControlColumn,
    [`euiDataGridRowCell--${textTransform}`]: textTransform,
  });

  const sharedCellProps = {
    rowIndex,
    visibleRowIndex,
    colIndex: columnIndex,
    interactiveCellId,
    className: classes,
    style: {
      ...style,
      top: `${parseFloat(style.top as string) + headerRowHeight}px`,
    },
    rowHeightsOptions,
    rowHeightUtils,
    setRowHeight: isFirstColumn ? setRowHeight : undefined,
    rowManager: rowManager,
  };

  if (isLeadingControlColumn) {
    const leadingColumn = leadingControlColumns[columnIndex];
    const { id, rowCellRender } = leadingColumn;

    cellContent = (
      <EuiDataGridCell
        {...sharedCellProps}
        columnId={id}
        popoverContent={DefaultColumnFormatter}
        width={leadingColumn.width}
        renderCellValue={rowCellRender}
        isExpandable={false}
      />
    );
  } else if (isTrailingControlColumn) {
    const columnOffset = columns.length + leadingControlColumns.length;
    const trailingColumnIndex = columnIndex - columnOffset;
    const trailingColumn = trailingControlColumns[trailingColumnIndex];
    const { id, rowCellRender } = trailingColumn;

    cellContent = (
      <EuiDataGridCell
        {...sharedCellProps}
        columnId={id}
        popoverContent={DefaultColumnFormatter}
        width={trailingColumn.width}
        renderCellValue={rowCellRender}
        isExpandable={false}
      />
    );
  } else {
    // this is a normal data cell

    // offset the column index by the leading control columns
    const columnType = schema[columnId] ? schema[columnId].columnType : null;

    const isExpandable =
      column.isExpandable !== undefined ? column.isExpandable : true;

    const popoverContent =
      popoverContents[columnType as string] || DefaultColumnFormatter;

    const width = columnWidths[columnId] || defaultColumnWidth;

    cellContent = (
      <EuiDataGridCell
        {...sharedCellProps}
        columnId={columnId}
        column={column}
        columnType={columnType}
        popoverContent={popoverContent}
        width={width || undefined}
        renderCellValue={renderCellValue}
        interactiveCellId={interactiveCellId}
        isExpandable={isExpandable}
      />
    );
  }

  return cellContent;
};

const InnerElement: VariableSizeGridProps['innerElementType'] = forwardRef<
  HTMLDivElement,
  { style: { height: number } }
>(({ children, style, ...rest }, ref) => {
  const { headerRowHeight, headerRow, footerRow } = useContext(
    DataGridWrapperRowsContext
  );
  return (
    <>
      <div
        ref={ref}
        style={{
          ...style,
          height: style.height + headerRowHeight,
        }}
        {...rest}
      >
        {headerRow}
        {children}
      </div>
      {footerRow}
    </>
  );
});
InnerElement.displayName = 'EuiDataGridInnerElement';

const IS_JEST_ENVIRONMENT = global.hasOwnProperty('_isJest');

/**
 * getParentCellContent is called by the grid body's mutation observer,
 * which exists to pick up DOM changes in cells and remove interactive elements
 * from the page's tab index, as we want to move between cells via arrow keys
 * instead of tabbing.
 *
 * So we start with a Node or HTMLElement returned by a mutation record
 * and search its ancestors for a div[data-datagrid-cellcontent], if any,
 * which is a valid target for disabling tabbing within
 */
export function getParentCellContent(_element: Node | HTMLElement) {
  let element: HTMLElement | null =
    _element.nodeType === document.ELEMENT_NODE
      ? (_element as HTMLElement)
      : _element.parentElement;

  while (
    element && // we haven't walked off the document yet
    element.nodeName !== 'div' && // looking for a div
    !element.hasAttribute('data-datagrid-cellcontent') // that has data-datagrid-cellcontent
  ) {
    element = element.parentElement;
  }
  return element;
}

// computes the unconstrained (total possible) height of a grid
const useUnconstrainedHeight = ({
  rowHeightUtils,
  startRow,
  endRow,
  getCorrectRowIndex,
  rowHeightsOptions,
  defaultHeight,
  headerRowHeight,
  footerRowHeight,
  outerGridRef,
  innerGridRef,
}: {
  rowHeightUtils: RowHeightUtils;
  startRow: number;
  endRow: number;
  getCorrectRowIndex: (rowIndex: number) => number;
  rowHeightsOptions?: EuiDataGridRowHeightsOptions;
  defaultHeight: number;
  headerRowHeight: number;
  footerRowHeight: number;
  outerGridRef: React.MutableRefObject<HTMLDivElement | null>;
  innerGridRef: React.MutableRefObject<HTMLDivElement | null>;
}) => {
  // when a row height is updated, force a re-render of the grid body to update the unconstrained height
  const forceRender = useForceRender();
  useEffect(() => {
    rowHeightUtils.setRerenderGridBody(forceRender);
  }, [rowHeightUtils, forceRender]);

  let knownHeight = 0; // tracks the pixel height of rows we know the size of
  let knownRowCount = 0; // how many rows we know the size of
  for (let i = startRow; i < endRow; i++) {
    const correctRowIndex = getCorrectRowIndex(i); // map visible row to logical row

    // lookup the height configuration of this row
    const rowHeightOption = rowHeightUtils.getRowHeightOption(
      correctRowIndex,
      rowHeightsOptions
    );

    if (rowHeightOption) {
      // this row's height is known
      knownRowCount++;
      knownHeight += rowHeightUtils.getCalculatedHeight(
        rowHeightOption,
        defaultHeight,
        correctRowIndex,
        rowHeightUtils.isRowHeightOverride(correctRowIndex, rowHeightsOptions)
      );
    }
  }

  // how many rows to provide space for on the screen
  const rowCountToAffordFor = endRow - startRow;

  // watch the inner element for a change to its width
  // which may cause the horizontal scrollbar to be added or removed
  const { width: innerWidth } = useResizeObserver(
    innerGridRef.current,
    'width'
  );
  useUpdateEffect(forceRender, [innerWidth]);

  // https://stackoverflow.com/a/5038256
  const hasHorizontalScroll =
    (outerGridRef.current?.scrollWidth ?? 0) >
    (outerGridRef.current?.clientWidth ?? 0);
  // https://stackoverflow.com/a/24797425
  const scrollbarHeight = hasHorizontalScroll
    ? outerGridRef.current!.offsetHeight - outerGridRef.current!.clientHeight
    : 0;

  const unconstrainedHeight =
    defaultHeight * (rowCountToAffordFor - knownRowCount) + // guess how much space is required for unknown rows
    knownHeight + // computed pixel height of the known rows
    headerRowHeight + // account for header
    footerRowHeight + // account for footer
    scrollbarHeight; // account for horizontal scrollbar

  return unconstrainedHeight;
};

export const EuiDataGridBody: FunctionComponent<EuiDataGridBodyProps> = (
  props
) => {
  const {
    isFullScreen,
    columnWidths,
    defaultColumnWidth,
    leadingControlColumns = [],
    trailingControlColumns = [],
    columns,
    schema,
    schemaDetectors,
    popoverContents,
    rowCount,
    renderCellValue,
    renderFooterCellValue,
    inMemory,
    inMemoryValues,
    interactiveCellId,
    pagination,
    setColumnWidth,
    headerIsInteractive,
    handleHeaderMutation,
    setVisibleColumns,
    switchColumnPos,
    toolbarHeight,
    rowHeightsOptions,
    rowHeightUtils,
    virtualizationOptions,
    gridStyles,
  } = props;

  const [headerRowRef, setHeaderRowRef] = useState<HTMLDivElement | null>(null);
  const [footerRowRef, setFooterRowRef] = useState<HTMLDivElement | null>(null);

  useMutationObserver(headerRowRef, handleHeaderMutation, {
    subtree: true,
    childList: true,
  });
  const { height: headerRowHeight } = useResizeObserver(headerRowRef, 'height');
  const { height: footerRowHeight } = useResizeObserver(footerRowRef, 'height');

  const startRow = pagination ? pagination.pageIndex * pagination.pageSize : 0;
  let endRow = pagination
    ? (pagination.pageIndex + 1) * pagination.pageSize
    : rowCount;
  endRow = Math.min(endRow, rowCount);

  const visibleRowIndices = useMemo(() => {
    const visibleRowIndices = [];
    for (let i = startRow; i < endRow; i++) {
      visibleRowIndices.push(i);
    }
    return visibleRowIndices;
  }, [startRow, endRow]);

  const sorting = useContext(DataGridSortingContext);
  const sortingColumns = sorting?.columns;

  const rowMap = useMemo(() => {
    const rowMap: { [key: number]: number } = {};

    if (
      inMemory?.level === 'sorting' &&
      sortingColumns != null &&
      sortingColumns.length > 0
    ) {
      const inMemoryRowIndices = Object.keys(inMemoryValues);
      const wrappedValues: Array<{
        index: number;
        values: EuiDataGridInMemoryValues[number];
      }> = [];
      for (let i = 0; i < inMemoryRowIndices.length; i++) {
        const inMemoryRow = inMemoryValues[inMemoryRowIndices[i]];
        wrappedValues.push({ index: i, values: inMemoryRow });
      }

      wrappedValues.sort((a, b) => {
        for (let i = 0; i < sortingColumns.length; i++) {
          const column = sortingColumns[i];
          const aValue = a.values[column.id];
          const bValue = b.values[column.id];

          // get the comparator, based on schema
          let comparator = defaultComparator;
          if (schema.hasOwnProperty(column.id)) {
            const columnType = schema[column.id].columnType;
            for (let i = 0; i < schemaDetectors.length; i++) {
              const detector = schemaDetectors[i];
              if (
                detector.type === columnType &&
                detector.hasOwnProperty('comparator')
              ) {
                comparator = detector.comparator!;
              }
            }
          }

          const result = comparator(aValue, bValue, column.direction);
          // only return if the columns are unequal, otherwise allow the next sort-by column to run
          if (result !== 0) return result;
        }

        return 0;
      });

      for (let i = 0; i < wrappedValues.length; i++) {
        rowMap[i] = wrappedValues[i].index;
      }
    }

    return rowMap;
  }, [
    sortingColumns,
    inMemoryValues,
    schema,
    schemaDetectors,
    inMemory?.level,
  ]);

  const mergedPopoverContents = useMemo(
    () => ({
      ...providedPopoverContents,
      ...popoverContents,
    }),
    [popoverContents]
  );

  const headerRow = useMemo(() => {
    return (
      <EuiDataGridHeaderRow
        ref={setHeaderRowRef}
        switchColumnPos={switchColumnPos}
        setVisibleColumns={setVisibleColumns}
        leadingControlColumns={leadingControlColumns}
        trailingControlColumns={trailingControlColumns}
        columns={columns}
        columnWidths={columnWidths}
        defaultColumnWidth={defaultColumnWidth}
        setColumnWidth={setColumnWidth}
        schema={schema}
        schemaDetectors={schemaDetectors}
        headerIsInteractive={headerIsInteractive}
      />
    );
  }, [
    switchColumnPos,
    setVisibleColumns,
    leadingControlColumns,
    trailingControlColumns,
    columns,
    columnWidths,
    defaultColumnWidth,
    setColumnWidth,
    schema,
    schemaDetectors,
    headerIsInteractive,
  ]);

  const footerRow = useMemo(() => {
    if (renderFooterCellValue == null) return null;
    return (
      <EuiDataGridFooterRow
        ref={setFooterRowRef}
        leadingControlColumns={leadingControlColumns}
        trailingControlColumns={trailingControlColumns}
        columns={columns}
        schema={schema}
        popoverContents={mergedPopoverContents}
        columnWidths={columnWidths}
        defaultColumnWidth={defaultColumnWidth}
        renderCellValue={renderFooterCellValue}
        rowIndex={visibleRowIndices.length}
        visibleRowIndex={visibleRowIndices.length}
        interactiveCellId={interactiveCellId}
      />
    );
  }, [
    columnWidths,
    columns,
    defaultColumnWidth,
    interactiveCellId,
    leadingControlColumns,
    mergedPopoverContents,
    renderFooterCellValue,
    schema,
    trailingControlColumns,
    visibleRowIndices.length,
  ]);

  const paginationOffset = pagination
    ? pagination.pageIndex * pagination.pageSize
    : 0;
  const getCorrectRowIndex = useCallback(
    (rowIndex: number) => {
      let rowIndexWithOffset = rowIndex;

      if (rowIndex - paginationOffset < 0) {
        rowIndexWithOffset = rowIndex + paginationOffset;
      }

      const correctRowIndex = rowMap.hasOwnProperty(rowIndexWithOffset)
        ? rowMap[rowIndexWithOffset]
        : rowIndexWithOffset;

      return correctRowIndex;
    },
    [paginationOffset, rowMap]
  );

  const gridRef = useRef<Grid | null>(null);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.resetAfterColumnIndex(0);
    }
  }, [columns, columnWidths, defaultColumnWidth]);

  const getWidth = useCallback(
    (index: number) => {
      if (index < leadingControlColumns.length) {
        // this is a leading control column
        return leadingControlColumns[index].width;
      } else if (index >= leadingControlColumns.length + columns.length) {
        // this is a trailing control column
        return trailingControlColumns[
          index - leadingControlColumns.length - columns.length
        ].width;
      }
      // normal data column
      return (
        columnWidths[columns[index - leadingControlColumns.length].id] ||
        defaultColumnWidth ||
        100
      );
    },
    [
      leadingControlColumns,
      columns,
      columnWidths,
      defaultColumnWidth,
      trailingControlColumns,
    ]
  );

  const setGridRef = useCallback(
    (ref: Grid | null) => {
      gridRef.current = ref;
      if (ref) {
        rowHeightUtils.setGrid(ref);
      }
    },
    [rowHeightUtils]
  );

  const [minRowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);

  const defaultHeight = useMemo(() => {
    return rowHeightsOptions?.defaultHeight
      ? rowHeightUtils.getCalculatedHeight(
          rowHeightsOptions.defaultHeight,
          minRowHeight
        )
      : minRowHeight;
  }, [rowHeightsOptions, minRowHeight, rowHeightUtils]);

  const getRowHeight = useCallback(
    (rowIndex) => {
      const correctRowIndex = getCorrectRowIndex(rowIndex);
      let height;

      const rowHeightOption = rowHeightUtils.getRowHeightOption(
        correctRowIndex,
        rowHeightsOptions
      );
      if (rowHeightOption) {
        height = rowHeightUtils.getCalculatedHeight(
          rowHeightOption,
          minRowHeight,
          correctRowIndex,
          rowHeightUtils.isRowHeightOverride(correctRowIndex, rowHeightsOptions)
        );
      }

      return height || defaultHeight;
    },
    [
      minRowHeight,
      rowHeightsOptions,
      getCorrectRowIndex,
      rowHeightUtils,
      defaultHeight,
    ]
  );

  useEffect(() => {
    if (gridRef.current && rowHeightsOptions) {
      gridRef.current.resetAfterRowIndex(0);
    }
  }, [
    pagination?.pageIndex,
    rowHeightsOptions,
    gridStyles?.cellPadding,
    gridStyles?.fontSize,
  ]);

  useEffect(() => {
    if (gridRef.current && pagination?.pageIndex !== undefined) {
      gridRef.current.scrollToItem({
        rowIndex: 0,
      });
    }
  }, [pagination?.pageIndex]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.resetAfterRowIndex(0);
    }
  }, [getRowHeight]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const wrapperDimensions = useResizeObserver(wrapperRef.current);

  const outerGridRef = useRef<HTMLDivElement | null>(null); // container that becomes scrollable
  const innerGridRef = useRef<HTMLDivElement | null>(null); // container sized to fit all content

  const unconstrainedHeight = useUnconstrainedHeight({
    rowHeightUtils,
    startRow,
    endRow,
    getCorrectRowIndex,
    rowHeightsOptions,
    defaultHeight,
    headerRowHeight,
    footerRowHeight,
    outerGridRef,
    innerGridRef,
  });

  // unable to determine this until the container's size is known anyway
  const unconstrainedWidth = 0;

  const [height, setHeight] = useState<number | undefined>(undefined);
  const [width, setWidth] = useState<number | undefined>(undefined);

  // useState instead of useMemo as React reserves the right to drop memoized
  // values in the future, and that would be very bad here
  const [rowManager] = useState<EuiDataGridRowManager>(() =>
    makeRowManager(innerGridRef)
  );

  useEffect(() => {
    const boundingRect = wrapperRef.current!.getBoundingClientRect();

    if (boundingRect.height !== unconstrainedHeight && !isFullScreen) {
      setHeight(boundingRect.height);
    }
    if (boundingRect.width !== unconstrainedWidth) {
      setWidth(boundingRect.width);
    }
  }, [rowCount, unconstrainedHeight, wrapperDimensions, isFullScreen]);

  const preventTabbing = useCallback((records: MutationRecord[]) => {
    // multiple mutation records can implicate the same cell
    // so be sure to only check each cell once
    const processedCells = new Set();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      // find the cell content owning this mutation
      const cell = getParentCellContent(record.target);
      if (processedCells.has(cell)) continue;
      processedCells.add(cell);

      if (cell) {
        // if we found it, disable tabbable elements
        const tabbables = tabbable(cell);
        for (let i = 0; i < tabbables.length; i++) {
          const element = tabbables[i];
          if (
            element.getAttribute('role') !== 'gridcell' &&
            !element.dataset['euigrid-tab-managed']
          ) {
            element.setAttribute('tabIndex', '-1');
            element.setAttribute('data-datagrid-interactable', 'true');
          }
        }
      }
    }
  }, []);

  let finalHeight = IS_JEST_ENVIRONMENT
    ? Number.MAX_SAFE_INTEGER
    : height || unconstrainedHeight;
  let finalWidth = IS_JEST_ENVIRONMENT
    ? Number.MAX_SAFE_INTEGER
    : width || unconstrainedWidth;
  if (isFullScreen) {
    finalHeight =
      window.innerHeight - toolbarHeight - headerRowHeight - footerRowHeight;
    finalWidth = window.innerWidth;
  }

  return (
    <EuiMutationObserver
      observerOptions={{ subtree: true, childList: true }}
      onMutation={preventTabbing}
    >
      {(mutationRef) => (
        <div
          data-test-subj="euiDataGridBody"
          style={{ width: '100%', height: '100%', overflow: 'hidden' }}
          ref={(el) => {
            wrapperRef.current = el;
            mutationRef(el);
          }}
        >
          {(IS_JEST_ENVIRONMENT || finalWidth > 0) && (
            <DataGridWrapperRowsContext.Provider
              value={{ headerRowHeight, headerRow, footerRow }}
            >
              <Grid
                {...(virtualizationOptions ? virtualizationOptions : {})}
                ref={setGridRef}
                innerElementType={InnerElement}
                outerRef={outerGridRef}
                innerRef={innerGridRef}
                className={VIRTUALIZED_CONTAINER_CLASS}
                columnCount={
                  leadingControlColumns.length +
                  columns.length +
                  trailingControlColumns.length
                }
                width={finalWidth}
                columnWidth={getWidth}
                height={finalHeight}
                rowHeight={getRowHeight}
                itemData={{
                  schemaDetectors,
                  setRowHeight,
                  getCorrectRowIndex,
                  rowMap,
                  rowOffset: pagination
                    ? pagination.pageIndex * pagination.pageSize
                    : 0,
                  leadingControlColumns,
                  trailingControlColumns,
                  columns,
                  schema,
                  popoverContents: mergedPopoverContents,
                  columnWidths,
                  defaultColumnWidth,
                  renderCellValue,
                  interactiveCellId,
                  rowHeightsOptions,
                  rowHeightUtils,
                  rowManager,
                }}
                rowCount={
                  IS_JEST_ENVIRONMENT || headerRowHeight > 0
                    ? visibleRowIndices.length
                    : 0
                }
              >
                {Cell}
              </Grid>
            </DataGridWrapperRowsContext.Provider>
          )}
        </div>
      )}
    </EuiMutationObserver>
  );
};
