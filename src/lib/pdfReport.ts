import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AudioFile } from '../App';

interface MeaningEntry {
  term: string;
  language: string;
  definition: string;
  partOfSpeech?: string;
  source?: string;
}

interface ReportOptions {
  file: AudioFile;
  meanings: MeaningEntry[];
}

const PAGE_MARGIN_X = 40;
const HEADER_TOP = 20;
const HEADER_HEIGHT = 34;
const CONTENT_START_Y = HEADER_TOP + HEADER_HEIGHT + 22;
const FOOTER_RESERVED = 34;
const SECTION_TITLE_OFFSET = 10;
const SECTION_GAP = 20;

const formatDateTime = (timestamp?: number) => {
  if (!timestamp) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
};

const formatBytes = (value: number) => {
  if (!value) {
    return 'Unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const formatted = value / Math.pow(1024, index);
  return `${formatted.toFixed(formatted >= 10 ? 1 : 2)} ${units[index]}`;
};

const sanitizeFilename = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);

const drawBrandMark = (doc: jsPDF, x: number, y: number, size: number) => {
  doc.setFillColor(124, 58, 237);
  doc.roundedRect(x, y, size, size, 6, 6, 'F');

  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.6);
  const points = [
    [x + size * 0.16, y + size * 0.56],
    [x + size * 0.28, y + size * 0.56],
    [x + size * 0.36, y + size * 0.28],
    [x + size * 0.50, y + size * 0.76],
    [x + size * 0.64, y + size * 0.32],
    [x + size * 0.74, y + size * 0.60],
    [x + size * 0.84, y + size * 0.42],
  ];

  for (let i = 0; i < points.length - 1; i += 1) {
    const [startX, startY] = points[i];
    const [endX, endY] = points[i + 1];
    doc.line(startX, startY, endX, endY);
  }
};

const drawPageHeader = (doc: jsPDF, generatedAt: string) => {
  const pageWidth = doc.internal.pageSize.getWidth();

  drawBrandMark(doc, PAGE_MARGIN_X, HEADER_TOP, 24);

  doc.setTextColor(24, 24, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('AI-Driven Audio Sanitization Report', PAGE_MARGIN_X + 32, HEADER_TOP + 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(82, 82, 91);
  doc.text(`Generated: ${generatedAt}`, PAGE_MARGIN_X + 32, HEADER_TOP + 24);

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.7);
  doc.line(PAGE_MARGIN_X, HEADER_TOP + HEADER_HEIGHT, pageWidth - PAGE_MARGIN_X, HEADER_TOP + HEADER_HEIGHT);
  doc.setTextColor(0, 0, 0);
};

const drawPageFooter = (doc: jsPDF, pageNumber: number, totalPages: number) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 18;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(PAGE_MARGIN_X, footerY - 8, pageWidth - PAGE_MARGIN_X, footerY - 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('AI-Driven Audio Sanitization', PAGE_MARGIN_X, footerY);
  doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - PAGE_MARGIN_X, footerY, { align: 'right' });
  doc.setTextColor(0, 0, 0);
};

const getNextSectionStartY = (doc: jsPDF, previousEndY: number, minimumSpace = 84) => {
  const pageHeight = doc.internal.pageSize.getHeight();
  const desiredStart = previousEndY + SECTION_GAP;
  const availableBottom = pageHeight - FOOTER_RESERVED;

  if (desiredStart + minimumSpace > availableBottom) {
    doc.addPage();
    return CONTENT_START_Y;
  }

  return desiredStart;
};

const drawSectionHeading = (doc: jsPDF, title: string, y: number) => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(title, PAGE_MARGIN_X, y);
};

const getLastTableY = (doc: jsPDF, fallbackY: number) => (doc as any).lastAutoTable?.finalY ?? fallbackY;

export function downloadProcessingReportPdf({ file, meanings }: ReportOptions) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const report = file.safetyReport ?? [];
  const profaneRows = report.filter((item) => item.is_profane);
  const generatedAt = formatDateTime(Date.now());

  drawPageHeader(doc, generatedAt);

  const wordFrequency = new Map<string, { term: string; language: string; count: number }>();
  const languageCounts = new Map<string, number>();

  profaneRows.forEach((entry) => {
    const term = entry.matched_profanity || entry.word;
    const language = entry.matched_profanity_language || 'Unknown';
    const key = `${term.toLowerCase()}::${language.toLowerCase()}`;

    const currentWord = wordFrequency.get(key);
    if (currentWord) {
      currentWord.count += 1;
    } else {
      wordFrequency.set(key, { term, language, count: 1 });
    }

    languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
  });

  const sortedWords = Array.from(wordFrequency.values()).sort((a, b) => b.count - a.count);
  const sortedLanguages = Array.from(languageCounts.entries()).sort((a, b) => b[1] - a[1]);

  let currentY = CONTENT_START_Y;
  drawSectionHeading(doc, '1. Source and Processing Specs', currentY);

  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Field', 'Value']],
    body: [
      ['Source Name', file.name || 'Unknown'],
      ['Source Type', file.url ? 'URL import' : 'Local upload'],
      ['Source URL', file.url || 'N/A'],
      ['Input MIME Type', file.type || 'Unknown'],
      ['Input Size', formatBytes(file.size)],
      ['Requested Format', file.requestedFormat || 'Unknown'],
      ['Output Filename', file.outputFilename || 'Not available'],
      ['Completed Datetime', formatDateTime(file.completedAt)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [52, 58, 64], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 150, fontStyle: 'bold' },
      1: { cellWidth: 360 },
    },
  });

  let afterSpecsY = getLastTableY(doc, currentY + 80);
  currentY = getNextSectionStartY(doc, afterSpecsY);
  drawSectionHeading(doc, '2. Analytics Summary', currentY);

  const profanityRate = report.length > 0 ? ((profaneRows.length / report.length) * 100).toFixed(1) : '0.0';

  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Metric', 'Value']],
    body: [
      ['Total Words Analyzed', String(report.length)],
      ['Total Profanity Detections', String(profaneRows.length)],
      ['Unique Profane Words', String(sortedWords.length)],
      ['Languages Detected (Profanity)', String(sortedLanguages.length)],
      ['Profanity Rate', `${profanityRate}%`],
      ['Most Frequent Profane Word', sortedWords[0] ? `${sortedWords[0].term} (${sortedWords[0].count}x)` : 'None'],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5, valign: 'middle' },
    headStyles: { fillColor: [99, 102, 241], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 220, fontStyle: 'bold' },
      1: { cellWidth: 290 },
    },
  });

  const afterSummaryY = getLastTableY(doc, currentY + 120);
  currentY = getNextSectionStartY(doc, afterSummaryY);
  drawSectionHeading(doc, '3. Top Profanity Terms', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Top Profane Terms', 'Language', 'Count']],
    body: sortedWords.slice(0, 20).map((item) => [item.term, item.language, String(item.count)]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 4, valign: 'middle' },
    headStyles: { fillColor: [139, 92, 246], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 300 },
      1: { cellWidth: 130 },
      2: { cellWidth: 45, halign: 'right' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '3. Top Profanity Terms (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const afterTopWordsY = getLastTableY(doc, currentY + 120);
  currentY = getNextSectionStartY(doc, afterTopWordsY);
  drawSectionHeading(doc, '4. Language Distribution', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Language', 'Detections', 'Share']],
    body: sortedLanguages.map(([language, count]) => [
      language,
      String(count),
      `${profaneRows.length ? ((count / profaneRows.length) * 100).toFixed(1) : '0.0'}%`,
    ]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 4, valign: 'middle' },
    headStyles: { fillColor: [6, 182, 212], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 280 },
      1: { cellWidth: 110, halign: 'right' },
      2: { cellWidth: 85, halign: 'right' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '4. Language Distribution (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const afterLanguageY = getLastTableY(doc, currentY + 100);
  currentY = getNextSectionStartY(doc, afterLanguageY);
  drawSectionHeading(doc, '5. Profanity Meanings', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Term', 'Language', 'Meaning', 'Part of Speech']],
    body: meanings.length > 0
      ? meanings.map((item) => [
          item.term,
          item.language,
          item.definition,
          item.partOfSpeech || '-',
        ])
      : [['-', '-', 'No dictionary meanings available for this report.', '-']],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 95 },
      1: { cellWidth: 65 },
      2: { cellWidth: 280 },
      3: { cellWidth: 100 },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '5. Profanity Meanings (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const afterMeaningsY = getLastTableY(doc, currentY + 120);
  currentY = getNextSectionStartY(doc, afterMeaningsY, 96);
  drawSectionHeading(doc, '6. Word Safety Report Data', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['#', 'Word', 'Start (s)', 'End (s)', 'Is Profane', 'Matched Profanity', 'Language', 'Not Safe Prob', 'Safe Prob']],
    body: report.map((item, index) => [
      String(index + 1),
      item.word,
      item.start.toFixed(2),
      item.end.toFixed(2),
      item.is_profane ? 'True' : 'False',
      item.matched_profanity || 'None',
      item.matched_profanity_language || '-',
      typeof item.not_safe_prob === 'number' ? item.not_safe_prob.toFixed(4) : '-',
      typeof item.safe_prob === 'number' ? item.safe_prob.toFixed(4) : '-',
    ]),
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [75, 85, 99], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 20, halign: 'right' },
      1: { cellWidth: 74 },
      2: { cellWidth: 46, halign: 'right' },
      3: { cellWidth: 46, halign: 'right' },
      4: { cellWidth: 42, halign: 'center' },
      5: { cellWidth: 95 },
      6: { cellWidth: 50 },
      7: { cellWidth: 62, halign: 'right' },
      8: { cellWidth: 62, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') {
        return;
      }

      const row = report[data.row.index];
      if (!row || !row.is_profane) {
        return;
      }

      data.cell.styles.textColor = [185, 28, 28];
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = [254, 242, 242];
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '6. Word Safety Report Data (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawPageHeader(doc, generatedAt);
    drawPageFooter(doc, page, totalPages);
  }

  const fileLabel = file.outputFilename || file.name || 'processing-report';
  doc.save(`${sanitizeFilename(fileLabel)}-report.pdf`);
}

export function buildProcessingReportPdfBlob({ file, meanings }: ReportOptions) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const report = file.safetyReport ?? [];
  const profaneRows = report.filter((item) => item.is_profane);
  const generatedAt = formatDateTime(Date.now());

  drawPageHeader(doc, generatedAt);

  const wordFrequency = new Map<string, { term: string; language: string; count: number }>();
  const languageCounts = new Map<string, number>();

  profaneRows.forEach((entry) => {
    const term = entry.matched_profanity || entry.word;
    const language = entry.matched_profanity_language || 'Unknown';
    const key = `${term.toLowerCase()}::${language.toLowerCase()}`;

    const currentWord = wordFrequency.get(key);
    if (currentWord) {
      currentWord.count += 1;
    } else {
      wordFrequency.set(key, { term, language, count: 1 });
    }

    languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
  });

  const sortedWords = Array.from(wordFrequency.values()).sort((a, b) => b.count - a.count);
  const sortedLanguages = Array.from(languageCounts.entries()).sort((a, b) => b[1] - a[1]);

  let currentY = CONTENT_START_Y;
  drawSectionHeading(doc, '1. Source and Processing Specs', currentY);

  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Field', 'Value']],
    body: [
      ['Source Name', file.name || 'Unknown'],
      ['Source Type', file.url ? 'URL import' : 'Local upload'],
      ['Source URL', file.url || 'N/A'],
      ['Input MIME Type', file.type || 'Unknown'],
      ['Input Size', formatBytes(file.size)],
      ['Requested Format', file.requestedFormat || 'Unknown'],
      ['Output Filename', file.outputFilename || 'Not available'],
      ['Completed Datetime', formatDateTime(file.completedAt)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [52, 58, 64], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 150, fontStyle: 'bold' },
      1: { cellWidth: 360 },
    },
  });

  let afterSpecsY = getLastTableY(doc, currentY + 80);
  currentY = getNextSectionStartY(doc, afterSpecsY);
  drawSectionHeading(doc, '2. Analytics Summary', currentY);

  const profanityRate = report.length > 0 ? ((profaneRows.length / report.length) * 100).toFixed(1) : '0.0';

  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Metric', 'Value']],
    body: [
      ['Total Words Analyzed', String(report.length)],
      ['Total Profanity Detections', String(profaneRows.length)],
      ['Unique Profane Words', String(sortedWords.length)],
      ['Languages Detected (Profanity)', String(sortedLanguages.length)],
      ['Profanity Rate', `${profanityRate}%`],
      ['Most Frequent Profane Word', sortedWords[0] ? `${sortedWords[0].term} (${sortedWords[0].count}x)` : 'None'],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5, valign: 'middle' },
    headStyles: { fillColor: [99, 102, 241], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 220, fontStyle: 'bold' },
      1: { cellWidth: 290 },
    },
  });

  const afterSummaryY = getLastTableY(doc, currentY + 120);
  currentY = getNextSectionStartY(doc, afterSummaryY);
  drawSectionHeading(doc, '3. Top Profanity Terms', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Top Profane Terms', 'Language', 'Count']],
    body: sortedWords.slice(0, 20).map((item) => [item.term, item.language, String(item.count)]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 4, valign: 'middle' },
    headStyles: { fillColor: [139, 92, 246], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 300 },
      1: { cellWidth: 130 },
      2: { cellWidth: 45, halign: 'right' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '3. Top Profanity Terms (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const afterTopWordsY = getLastTableY(doc, currentY + 120);
  currentY = getNextSectionStartY(doc, afterTopWordsY);
  drawSectionHeading(doc, '4. Language Distribution', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Language', 'Detections', 'Share']],
    body: sortedLanguages.map(([language, count]) => [
      language,
      String(count),
      `${profaneRows.length ? ((count / profaneRows.length) * 100).toFixed(1) : '0.0'}%`,
    ]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 4, valign: 'middle' },
    headStyles: { fillColor: [6, 182, 212], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 280 },
      1: { cellWidth: 110, halign: 'right' },
      2: { cellWidth: 85, halign: 'right' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '4. Language Distribution (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const afterLanguageY = getLastTableY(doc, currentY + 100);
  currentY = getNextSectionStartY(doc, afterLanguageY);
  drawSectionHeading(doc, '5. Profanity Meanings', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['Term', 'Language', 'Meaning', 'Part of Speech']],
    body: meanings.length > 0
      ? meanings.map((item) => [
          item.term,
          item.language,
          item.definition,
          item.partOfSpeech || '-',
        ])
      : [['-', '-', 'No dictionary meanings available for this report.', '-']],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [16, 185, 129], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 95 },
      1: { cellWidth: 65 },
      2: { cellWidth: 280 },
      3: { cellWidth: 100 },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '5. Profanity Meanings (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const afterMeaningsY = getLastTableY(doc, currentY + 120);
  currentY = getNextSectionStartY(doc, afterMeaningsY, 96);
  drawSectionHeading(doc, '6. Word Safety Report Data', currentY);
  autoTable(doc, {
    startY: currentY + SECTION_TITLE_OFFSET,
    margin: { top: CONTENT_START_Y, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: FOOTER_RESERVED },
    head: [['#', 'Word', 'Start (s)', 'End (s)', 'Is Profane', 'Matched Profanity', 'Language', 'Not Safe Prob', 'Safe Prob']],
    body: report.map((item, index) => [
      String(index + 1),
      item.word,
      item.start.toFixed(2),
      item.end.toFixed(2),
      item.is_profane ? 'True' : 'False',
      item.matched_profanity || 'None',
      item.matched_profanity_language || '-',
      typeof item.not_safe_prob === 'number' ? item.not_safe_prob.toFixed(4) : '-',
      typeof item.safe_prob === 'number' ? item.safe_prob.toFixed(4) : '-',
    ]),
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [75, 85, 99], halign: 'left', valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 20, halign: 'right' },
      1: { cellWidth: 74 },
      2: { cellWidth: 46, halign: 'right' },
      3: { cellWidth: 46, halign: 'right' },
      4: { cellWidth: 42, halign: 'center' },
      5: { cellWidth: 95 },
      6: { cellWidth: 50 },
      7: { cellWidth: 62, halign: 'right' },
      8: { cellWidth: 62, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') {
        return;
      }

      const row = report[data.row.index];
      if (!row || !row.is_profane) {
        return;
      }

      data.cell.styles.textColor = [185, 28, 28];
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = [254, 242, 242];
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSectionHeading(doc, '6. Word Safety Report Data (continued)', CONTENT_START_Y - SECTION_TITLE_OFFSET);
      }
    },
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawPageHeader(doc, generatedAt);
    drawPageFooter(doc, page, totalPages);
  }

  return doc.output('blob');
}
