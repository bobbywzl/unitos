// The sheets benchmark's reference for a workbook (scripts/parse-bench/sheets.mts):
// Apache POI reads the .xlsx — never the code under test — and writes what a
// reader should see of each sheet as JSON: the sheets in workbook order with
// their names and whether they are hidden, and per visible sheet the cells as
// Excel shows them (POI's DataFormatter, cached values for formulas), the
// merges, and the frozen rows and columns. The grid is the spec's (SPEC.md
// §27): hidden rows and columns left out, trailing empty rows and columns
// trimmed, at most 10,000 rows and 256 columns. A formula the file stores
// without its value (a workbook a library wrote, as openpyxl does) shows what
// Excel shows on opening it: POI computes it; one POI cannot compute is left
// empty.
//
//   java -cp '.bench/sheets/jars/*' scripts/parse-bench/sheets-ref/SheetsRef.java in.xlsx out.json [in out ...]
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.FormulaError;
import org.apache.poi.ss.usermodel.FormulaEvaluator;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.ss.util.PaneInformation;
import org.apache.poi.xssf.usermodel.XSSFCell;
import org.apache.poi.xssf.usermodel.XSSFChartSheet;

public class SheetsRef {
  static final int MAX_ROWS = 10_000;
  static final int MAX_COLS = 256;

  public static void main(String[] args) throws Exception {
    for (int i = 0; i + 1 < args.length; i += 2) {
      String json;
      try {
        json = read(new File(args[i]));
      } catch (Throwable e) {
        json = "{\"error\":" + str(e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage())) + "}";
      }
      Files.writeString(Path.of(args[i + 1]), json, StandardCharsets.UTF_8);
    }
  }

  static String read(File file) throws Exception {
    StringBuilder out = new StringBuilder("{\"sheets\":[");
    try (InputStream in = new FileInputStream(file); Workbook wb = WorkbookFactory.create(in)) {
      DataFormatter formatter = new DataFormatter(Locale.US);
      formatter.setUseCachedValuesForFormulaCells(true);
      FormulaEvaluator evaluator = wb.getCreationHelper().createFormulaEvaluator();
      for (int s = 0; s < wb.getNumberOfSheets(); s++) {
        Sheet sheet = wb.getSheetAt(s);
        boolean hidden = wb.isSheetHidden(s) || wb.isSheetVeryHidden(s);
        if (s > 0) out.append(',');
        out.append("{\"name\":").append(str(wb.getSheetName(s))).append(",\"hidden\":").append(hidden);
        if (sheet instanceof XSSFChartSheet) {
          out.append(",\"chartsheet\":true,\"rows\":[],\"merges\":[],\"frozenRows\":0,\"frozenCols\":0}");
          continue;
        }
        computeUncached(sheet, evaluator);
        sheetJson(sheet, formatter, out);
        out.append('}');
      }
    }
    return out.append("]}").toString();
  }

  /** Formulas stored without a value get the value POI computes. */
  static void computeUncached(Sheet sheet, FormulaEvaluator evaluator) {
    for (Row row : sheet) {
      if (row.getRowNum() >= MAX_ROWS) break;
      for (Cell cell : row) {
        if (cell.getCellType() != CellType.FORMULA || !(cell instanceof XSSFCell x) || x.getCTCell().isSetV()) continue;
        try {
          evaluator.evaluateFormulaCell(cell);
        } catch (Throwable e) {
          cell.setBlank();
        }
      }
    }
  }

  record RefCell(String text, String kind, boolean general, Double number) {}

  static void sheetJson(Sheet sheet, DataFormatter formatter, StringBuilder out) {
    int lastRow = Math.min(sheet.getLastRowNum(), MAX_ROWS - 1);
    int totalRows = sheet.getLastRowNum() + 1;
    // Every cell as shown, by sheet coordinates.
    List<RefCell[]> grid = new ArrayList<>();
    int maxCol = -1;
    for (int r = 0; r <= lastRow; r++) {
      Row row = sheet.getRow(r);
      RefCell[] cells = new RefCell[0];
      if (row != null && row.getLastCellNum() > 0) {
        int last = Math.min(row.getLastCellNum(), MAX_COLS);
        cells = new RefCell[last];
        for (int c = 0; c < last; c++) {
          Cell cell = row.getCell(c);
          if (cell == null) continue;
          RefCell rc = cellOf(cell, formatter);
          if (rc == null) continue;
          cells[c] = rc;
          if (!rc.text.isEmpty()) maxCol = Math.max(maxCol, c);
        }
      }
      grid.add(cells);
    }
    boolean[] hiddenRow = new boolean[grid.size()];
    for (int r = 0; r < grid.size(); r++) {
      Row row = sheet.getRow(r);
      hiddenRow[r] = row != null && row.getZeroHeight();
    }
    // The used range: the last row and column with words, and merges whose
    // origin has words.
    int usedRow = -1;
    for (int r = 0; r < grid.size(); r++) for (RefCell c : grid.get(r)) if (c != null && !c.text.isEmpty()) usedRow = r;
    List<CellRangeAddress> merges = new ArrayList<>(sheet.getMergedRegions());
    for (CellRangeAddress m : merges) {
      int r0 = m.getFirstRow(), c0 = m.getFirstColumn();
      if (r0 < grid.size() && c0 < grid.get(r0).length && grid.get(r0)[c0] != null && !grid.get(r0)[c0].text.isEmpty()) {
        usedRow = Math.max(usedRow, Math.min(m.getLastRow(), MAX_ROWS - 1));
        maxCol = Math.max(maxCol, Math.min(m.getLastColumn(), MAX_COLS - 1));
      }
    }
    int[] rowMap = new int[usedRow + 1];
    int keptRows = 0;
    for (int r = 0; r <= usedRow; r++) rowMap[r] = r < hiddenRow.length && hiddenRow[r] ? -1 : keptRows++;
    int[] colMap = new int[maxCol + 1];
    int keptCols = 0;
    for (int c = 0; c <= maxCol; c++) colMap[c] = sheet.isColumnHidden(c) ? -1 : keptCols++;

    out.append(",\"rows\":[");
    boolean firstRow = true;
    for (int r = 0; r <= usedRow; r++) {
      if (rowMap[r] < 0) continue;
      if (!firstRow) out.append(',');
      firstRow = false;
      out.append('[');
      RefCell[] cells = r < grid.size() ? grid.get(r) : new RefCell[0];
      // Trailing empty cells of the row are left out.
      int lastKept = -1;
      for (int c = 0; c <= maxCol && c < cells.length; c++) if (colMap[c] >= 0 && cells[c] != null && !cells[c].text.isEmpty()) lastKept = c;
      boolean firstCell = true;
      for (int c = 0; c <= lastKept; c++) {
        if (colMap[c] < 0) continue;
        if (!firstCell) out.append(',');
        firstCell = false;
        RefCell cell = cells[c];
        if (cell == null || cell.text.isEmpty()) {
          out.append("null");
          continue;
        }
        out.append("{\"t\":").append(str(cell.text)).append(",\"k\":\"").append(cell.kind).append('"');
        if (cell.general) out.append(",\"g\":1");
        if (cell.number != null && Double.isFinite(cell.number)) out.append(",\"v\":").append(cell.number);
        out.append('}');
      }
      out.append(']');
    }
    out.append("],\"merges\":[");
    boolean firstMerge = true;
    for (CellRangeAddress m : merges) {
      int r0 = m.getFirstRow(), c0 = m.getFirstColumn();
      if (r0 > usedRow || c0 > maxCol || rowMap[r0] < 0 || colMap[c0] < 0) continue;
      int r1 = rowMap[r0], c1 = colMap[c0];
      for (int r = r0; r <= Math.min(m.getLastRow(), usedRow); r++) if (rowMap[r] >= 0) r1 = rowMap[r];
      for (int c = c0; c <= Math.min(m.getLastColumn(), maxCol); c++) if (colMap[c] >= 0) c1 = colMap[c];
      if (r1 == rowMap[r0] && c1 == colMap[c0]) continue;
      if (!firstMerge) out.append(',');
      firstMerge = false;
      out.append('[').append(rowMap[r0]).append(',').append(colMap[c0]).append(',').append(r1).append(',').append(c1).append(']');
    }
    out.append(']');
    int frozenRows = 0, frozenCols = 0;
    PaneInformation pane = sheet.getPaneInformation();
    if (pane != null && pane.isFreezePane()) {
      for (int r = 0; r < pane.getHorizontalSplitPosition() && r <= usedRow; r++) if (rowMap[r] >= 0) frozenRows++;
      for (int c = 0; c < pane.getVerticalSplitPosition() && c <= maxCol; c++) if (colMap[c] >= 0) frozenCols++;
    }
    out.append(",\"frozenRows\":").append(frozenRows).append(",\"frozenCols\":").append(frozenCols);
    if (totalRows > MAX_ROWS) out.append(",\"cutRows\":").append(totalRows);
  }

  static RefCell cellOf(Cell cell, DataFormatter formatter) {
    CellType type = cell.getCellType();
    if (type == CellType.FORMULA) type = cell.getCachedFormulaResultType();
    String format = cell.getCellStyle() == null ? "General" : cell.getCellStyle().getDataFormatString();
    boolean general = format == null || format.equalsIgnoreCase("General");
    switch (type) {
      case STRING:
        return new RefCell(cell.getCellType() == CellType.FORMULA ? cell.getRichStringCellValue().getString() : formatter.formatCellValue(cell), "s", general, null);
      case NUMERIC:
        return new RefCell(formatter.formatCellValue(cell), "n", general, cell.getNumericCellValue());
      case BOOLEAN:
        return new RefCell(cell.getBooleanCellValue() ? "TRUE" : "FALSE", "b", general, null);
      case ERROR: {
        String text;
        try {
          text = FormulaError.forInt(cell.getErrorCellValue()).getString();
        } catch (Exception e) {
          text = "#ERROR";
        }
        return new RefCell(text, "e", general, null);
      }
      default:
        return null;
    }
  }

  static String str(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      switch (ch) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> {
          if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
          else b.append(ch);
        }
      }
    }
    return b.append('"').toString();
  }
}
