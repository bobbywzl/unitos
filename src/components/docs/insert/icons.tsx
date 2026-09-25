// The insert area's symbols (SPEC.md §29): Google's Material icons (Apache
// 2.0) on a 24-unit grid, drawn the way components/docs/icons.tsx draws the
// toolbar's. The five image layout symbols are drawn here in the same style.

type Props = { size?: number; className?: string };

function icon(path: string, name: string) {
  function Icon({ size = 20, className }: Props) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        focusable="false"
        className={className}
      >
        <path d={path} />
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const CutIcon = icon(
  "M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3z",
  "CutIcon",
);
export const CopyIcon = icon(
  "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  "CopyIcon",
);
export const PasteIcon = icon(
  "M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z",
  "PasteIcon",
);
export const PastePlainIcon = icon(
  "M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h6v-2H5V4h2v3h10V4h2v7h2V4c0-1.1-.9-2-2-2zm-7 2c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm9.41 9.83L20 12.41l-2.59 2.59L14.83 12.41 13.41 13.83 16 16.41l-2.59 2.59 1.42 1.41L17.41 17.83 20 20.41l1.41-1.41-2.58-2.59z",
  "PastePlainIcon",
);
export const DeleteIcon = icon(
  "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4z",
  "DeleteIcon",
);
export const LinkOffIcon = icon(
  "M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1 0 1.43-.98 2.63-2.31 2.98l1.46 1.46C20.88 15.61 22 13.95 22 12c0-2.76-2.24-5-5-5zm-1 4h-2.19l2 2H16zM2 4.27l3.11 3.11C3.29 8.12 2 9.91 2 12c0 2.76 2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1 0-1.59 1.21-2.9 2.76-3.07L8.73 11H8v2h2.73L13 15.27V17h1.73l4.01 4L20 19.74 3.27 3 2 4.27z",
  "LinkOffIcon",
);
export const TextFormatIcon = icon(
  "M5 17v2h14v-2H5zm4.5-4.2h5l.9 2.2h2.1L12.75 4h-1.5L6.5 15h2.1l.9-2.2zM12 5.98L13.87 11h-3.74L12 5.98z",
  "TextFormatIcon",
);
export const PinIcon = icon(
  "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z",
  "PinIcon",
);
export const UnpinIcon = icon(
  "M2.81 2.81L1.39 4.22 8 10.83V12c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7h.2l6.61 6.61 1.41-1.42L2.81 2.81zM16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v2.17l8.46 8.46c.58-.6.54-.63.54-1.63h2v-2c-1.66 0-3-1.34-3-3z",
  "UnpinIcon",
);
export const DragIcon = icon(
  "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  "DragIcon",
);
export const DragHorizontalIcon = icon(
  "M20 9H4v2h16V9zM4 15h16v-2H4v2z",
  "DragHorizontalIcon",
);
export const SortIcon = icon("M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z", "SortIcon");
export const ArrowUpIcon = icon("M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z", "ArrowUpIcon");
export const ArrowDownIcon = icon("M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z", "ArrowDownIcon");
export const SplitIcon = icon(
  "M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z",
  "SplitIcon",
);
export const MergeIcon = icon(
  "M3 5v14h2V5H3zm16 0v14h2V5h-2zM7.5 11l3-3 1.06 1.06L10.12 10.5H13.9l-1.44-1.44L13.5 8l3 3-3 3-1.06-1.06 1.44-1.44H10.1l1.44 1.44L10.5 14l-3-3z",
  "MergeIcon",
);
export const CropIcon = icon(
  "M17 15h2V7c0-1.1-.9-2-2-2H9v2h8v8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2H7z",
  "CropIcon",
);
export const RotateIcon = icon(
  "M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z",
  "RotateIcon",
);
export const ResetIcon = icon(
  "M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6 0 2.97-2.17 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93 0-4.42-3.58-8-8-8zm-6 8c0-1.65.67-3.15 1.76-4.24L6.34 7.34C4.9 8.79 4 10.79 4 13c0 4.08 3.05 7.44 7 7.93v-2.02c-2.83-.48-5-2.94-5-5.91z",
  "ResetIcon",
);
export const BorderColorIcon = icon(
  "M16.81 8.94l-3.75-3.75L4 14.25V18h3.75l9.06-9.06zM6 16v-.92l7.06-7.06.92.92L6.92 16H6zm13.71-9.96c.39-.39.39-1.02 0-1.41L17.37 2.29c-.2-.2-.45-.29-.71-.29s-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83zM2 20h20v4H2z",
  "BorderColorIcon",
);
export const BorderWeightIcon = icon("M3 17h18v-2H3v2zm0 3h18v-1H3v1zm0-7h18v-3H3v3zm0-9v4h18V4H3z", "BorderWeightIcon");
export const BorderDashIcon = icon(
  "M3 16h5v-2H3v2zm6.5 0h5v-2h-5v2zm6.5 0h5v-2h-5v2zM3 20h2v-2H3v2zm4 0h2v-2H7v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2zM3 12h8v-2H3v2zm10 0h8v-2h-8v2zM3 4v4h18V4H3z",
  "BorderDashIcon",
);
export const FillIcon = icon(
  "M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z",
  "FillIcon",
);
export const EventIcon = icon(
  "M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z",
  "EventIcon",
);
export const DropdownChipIcon = icon(
  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-5.5l-4-4h8l-4 4z",
  "DropdownChipIcon",
);
export const MoodIcon = icon(
  "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z",
  "MoodIcon",
);
export const TitleIcon = icon("M5 4v3h5.5v12h3V7H19V4z", "TitleIcon");
export const BookmarkIcon = icon(
  "M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z",
  "BookmarkIcon",
);
export const FootnoteIcon = icon("M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z", "FootnoteIcon");
export const FunctionsIcon = icon("M18 4H6v2l6.5 6L6 18v2h12v-3h-7l5-5-5-5h7z", "FunctionsIcon");
export const CodeIcon = icon(
  "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
  "CodeIcon",
);
export const ChevronRightIcon = icon("M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z", "ChevronRightIcon");
export const ChevronLeftIcon = icon("M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z", "ChevronLeftIcon");
export const ArrowBackIcon = icon("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", "ArrowBackIcon");
export const OpenInNewIcon = icon(
  "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  "OpenInNewIcon",
);
export const ClockIcon = icon(
  "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  "ClockIcon",
);
export const SettingsIcon = icon(
  "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  "SettingsIcon",
);
export const RefreshIcon = icon(
  "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  "RefreshIcon",
);
export const CalendarIcon = icon(
  "M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z",
  "CalendarIcon",
);
export const MeetingNotesIcon = icon(
  "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h8v2H8v-2zm0 3h5v2H8v-2z",
  "MeetingNotesIcon",
);
export const EmailIcon = icon(
  "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z",
  "EmailIcon",
);
export const MapIcon = icon(
  "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
  "MapIcon",
);
export const AssignmentIcon = icon(
  "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
  "AssignmentIcon",
);
export const FolderIcon = icon(
  "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z",
  "FolderIcon",
);
export const TaskIcon = icon(
  "M22 5.18L10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zM12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8c1.57 0 3.04.46 4.28 1.25l1.45-1.45C16.1 2.67 14.13 2 12 2 6.48 2 2 6.48 2 12s4.48 10 10 10c1.73 0 3.36-.44 4.78-1.22l-1.5-1.5c-1 .46-2.11.72-3.28.72zm7-5h-3v2h3v3h2v-3h3v-2h-3v-3h-2v3z",
  "TaskIcon",
);
export const AltTextIcon = icon(
  "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 15h2.5l.6-1.6h2.8l.6 1.6H16l-3-8h-3l-3 8zm3.6-3.3l.9-2.5.9 2.5h-1.8z",
  "AltTextIcon",
);
export const ImageOptionsIcon = icon(
  "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
  "ImageOptionsIcon",
);
export const TableRowIcon = icon("M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v6H5V5h14zM5 19v-6h14v6H5z", "TableRowIcon");
export const TableColumnIcon = icon("M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 19V5h6v14H5zm14 0h-6V5h6v14z", "TableColumnIcon");
export const DistributeRowsIcon = icon("M3 3h18v2H3V3zm0 16h18v2H3v-2zm0-8h18v2H3v-2zm9-4l3 3H9l3-3zm0 10l-3-3h6l-3 3z", "DistributeRowsIcon");
export const DistributeColumnsIcon = icon("M3 3h2v18H3V3zm16 0h2v18h-2V3zm-8 0h2v18h-2V3zM7 12l3-3v6l-3-3zm10 0l-3 3V9l3 3z", "DistributeColumnsIcon");

// The image layout symbols: the lines are text, the box is the image.
export const InLineIcon = icon("M3 4h18v2H3V4zm0 14h18v2H3v-2zm0-5h4v2H3v-2zm14 0h4v2h-4v-2zM8.5 9h7v7h-7V9z", "InLineIcon");
export const WrapTextIcon = icon("M3 4h18v2H3V4zm0 14h18v2H3v-2zm10-9h8v2h-8V9zm0 4h8v2h-8v-2zM3 8.5h8v7H3v-7z", "WrapTextIcon");
export const BreakTextIcon = icon("M3 3h18v2H3V3zm0 16h18v2H3v-2zm4-12h10v10H7V7z", "BreakTextIcon");
export const BehindTextIcon = icon(
  "M7 5h10v14H7V5zm2 2v10h6V7H9zM3 8h18v2H3V8zm0 6h18v2H3v-2z",
  "BehindTextIcon",
);
export const InFrontIcon = icon("M3 8h3v2H3V8zm15 0h3v2h-3V8zM3 14h3v2H3v-2zm15 0h3v2h-3v-2zM7 5h10v14H7V5z", "InFrontIcon");
