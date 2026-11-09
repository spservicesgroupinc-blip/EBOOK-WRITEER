import { jsPDF } from 'jspdf';
import { BookOutline, ChapterContent } from '../types';
import { formatImageSrc } from './gemini';
import { fitArtwork } from './artwork';

/**
 * Normalizes Unicode smart punctuation and strips raw markdown syntax
 * so standard PDF vector fonts (Times / Helvetica) render every character cleanly.
 */
function sanitizePdfText(input: string): string {
  if (!input) return '';
  return String(input)
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, ' — ')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    // Strip unsupported emojis or non-Latin1 symbols that standard PDF Times font cannot encode
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF—–]/g, '')
    .replace(/\s+—\s+/g, ' -- ')
    .replace(/[—–]/g, '--');
}

/**
 * Rasterizes any SVG, PNG, or JPEG base64/dataURL image onto an offscreen canvas
 * and returns a clean JPEG data URL suitable for jsPDF.addImage().
 */
async function rasterizeImageForPdf(
  rawImg: string | undefined,
  canvasWidth: number,
  canvasHeight: number
): Promise<string | null> {
  if (!rawImg || typeof document === 'undefined') return null;
  const src = formatImageSrc(rawImg);
  if (!src) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      resolve(null);
    }, 4000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        const fitted = fitArtwork(img.naturalWidth, img.naturalHeight, canvasWidth, canvasHeight);
        ctx.drawImage(img, fitted.x, fitted.y, fitted.width, fitted.height);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };

    img.src = src;
  });
}

interface ParsedBlock {
  type: 'heading1' | 'heading2' | 'heading3' | 'scenebreak' | 'paragraph' | 'quote';
  text: string;
}

function parseMarkdownToBlocks(markdown: string): ParsedBlock[] {
  if (!markdown) return [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];
  let paraBuffer: string[] = [];

  const flushParagraph = () => {
    if (paraBuffer.length > 0) {
      const joined = sanitizePdfText(paraBuffer.join(' ').replace(/\s+/g, ' ').trim());
      if (joined) {
        blocks.push({ type: 'paragraph', text: joined });
      }
      paraBuffer = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    if (/^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_|\*{3,}|-{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'scenebreak', text: '*   *   *' });
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      const text = sanitizePdfText(line.replace(/^###\s+/, ''));
      if (text) blocks.push({ type: 'heading3', text });
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      const text = sanitizePdfText(line.replace(/^##\s+/, ''));
      if (text) blocks.push({ type: 'heading2', text });
      continue;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      const text = sanitizePdfText(line.replace(/^#\s+/, ''));
      if (text) blocks.push({ type: 'heading1', text });
      continue;
    }

    if (line.startsWith('> ')) {
      flushParagraph();
      const text = sanitizePdfText(line.replace(/^>\s+/, ''));
      if (text) blocks.push({ type: 'quote', text });
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph();
      const text = sanitizePdfText(line.replace(/^[-*]\s+/, ''));
      if (text) blocks.push({ type: 'paragraph', text: `• ${text}` });
      continue;
    }

    paraBuffer.push(line);
  }

  flushParagraph();
  return blocks;
}

export async function generateBookPdf(
  outline: BookOutline,
  chapters: ChapterContent[]
): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 25;
  const topMargin = 28;
  const bottomMargin = 26;
  const contentWidth = pageWidth - marginX * 2; // 160mm
  const maxBodyY = pageHeight - bottomMargin; // 271mm

  const cleanBookTitle = sanitizePdfText(outline.title || 'Untitled Manuscript');
  const cleanDescription = sanitizePdfText(outline.description || '');

  // ---------------------------------------------------------------------------
  // 1. COVER PAGE (Optional if coverImage exists)
  // ---------------------------------------------------------------------------
  let hasCoverPage = false;
  if (outline.coverImage) {
    const coverJpeg = await rasterizeImageForPdf(outline.coverImage, 1800, 2400);
    if (coverJpeg) {
      hasCoverPage = true;
      // Deep navy editorial background frame
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');

      const imgW = 162;
      const imgH = 216;
      const imgX = (pageWidth - imgW) / 2;
      const imgY = (pageHeight - imgH) / 2 - 4;

      // Subtle gold outer border
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(0.5);
      doc.rect(imgX - 3, imgY - 3, imgW + 6, imgH + 6, 'S');

      doc.addImage(coverJpeg, 'JPEG', imgX, imgY, imgW, imgH);
      doc.addPage();
    }
  }

  // ---------------------------------------------------------------------------
  // 2. FORMAL TITLE PAGE
  // ---------------------------------------------------------------------------
  // Outer decorative border
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.rect(18, 18, pageWidth - 36, pageHeight - 36, 'S');
  doc.setLineWidth(0.15);
  doc.rect(20, 20, pageWidth - 40, pageHeight - 40, 'S');

  // Top decorative rule
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.6);
  doc.line(pageWidth / 2 - 25, 68, pageWidth / 2 + 25, 68);

  // Book Title
  doc.setFont('times', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(15, 23, 42);
  const titleLines: string[] = doc.splitTextToSize(cleanBookTitle.toUpperCase(), contentWidth - 16);
  let titleY = 86;
  for (const line of titleLines) {
    doc.text(line, pageWidth / 2, titleY, { align: 'center' });
    titleY += 11.5;
  }

  // Center ornament
  titleY += 4;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(pageWidth / 2 - 18, titleY, pageWidth / 2 + 18, titleY);

  // Synopsis / Subtitle
  if (cleanDescription) {
    titleY += 14;
    doc.setFont('times', 'italic');
    doc.setFontSize(11.5);
    doc.setTextColor(71, 85, 105);
    const descLines: string[] = doc.splitTextToSize(cleanDescription, contentWidth - 24).slice(0, 12);
    for (const line of descLines) {
      doc.text(line, pageWidth / 2, titleY, { align: 'center' });
      titleY += 6;
    }
  }

  // Publisher Imprint at Bottom
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('EBOOK.AI PUBLISHING STUDIO', pageWidth / 2, pageHeight - 36, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Original Manuscript Edition • ${new Date().getFullYear()}`, pageWidth / 2, pageHeight - 30, {
    align: 'center',
  });

  // ---------------------------------------------------------------------------
  // 3. RESERVE TABLE OF CONTENTS PAGE(S)
  // ---------------------------------------------------------------------------
  const tocEntriesPerPage = 22;
  const numTocPages = Math.max(1, Math.ceil(chapters.length / tocEntriesPerPage));
  const tocStartPage = doc.getNumberOfPages() + 1;
  for (let i = 0; i < numTocPages; i++) {
    doc.addPage();
  }

  // Track chapter metadata for TOC and Running Headers
  const chapterTocMeta: {
    label: string;
    title: string;
    startPage: number;
    endPage: number;
  }[] = [];

  // ---------------------------------------------------------------------------
  // 4. TYPESET CHAPTERS
  // ---------------------------------------------------------------------------
  for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
    const chap = chapters[cIdx];
    doc.addPage();
    const chapterStartPage = doc.getNumberOfPages();

    const chapLabel =
      chap.chapterNumber === 0 ? 'INTRODUCTION' : `CHAPTER ${chap.chapterNumber}`;
    const rawChapTitle = sanitizePdfText(chap.title || chapLabel);
    // Strip redundant "Chapter X:" prefix if already present in chap.title
    const cleanChapTitle =
      rawChapTitle.replace(/^(?:chapter\s+\d+|introduction)\s*[:\-–]\s*/i, '').trim() ||
      rawChapTitle;

    let cursorY = 44;

    // Chapter Number / Label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(chapLabel, pageWidth / 2, cursorY, { align: 'center' });
    cursorY += 5;

    // Decorative rule under chapter label
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.35);
    doc.line(pageWidth / 2 - 14, cursorY, pageWidth / 2 + 14, cursorY);
    cursorY += 11;

    // Chapter Title
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    const chapTitleLines: string[] = doc.splitTextToSize(cleanChapTitle, contentWidth - 12);
    for (const line of chapTitleLines) {
      doc.text(line, pageWidth / 2, cursorY, { align: 'center' });
      cursorY += 8.5;
    }
    cursorY += 8;

    // Optional Chapter Illustration
    if (chap.image) {
      const chapJpeg = await rasterizeImageForPdf(chap.image, 1600, 900);
      if (chapJpeg) {
        const imgW = 128;
        const imgH = 72;
        if (cursorY + imgH + 10 > maxBodyY) {
          doc.addPage();
          cursorY = topMargin;
        }
        const imgX = (pageWidth - imgW) / 2;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.rect(imgX - 1, cursorY - 1, imgW + 2, imgH + 2, 'S');
        doc.addImage(chapJpeg, 'JPEG', imgX, cursorY, imgW, imgH);
        cursorY += imgH + 10;
      }
    }

    // Parse & Typeset Chapter Body
    const blocks = parseMarkdownToBlocks(
      chap.content || 'This chapter has not been written yet.'
    );
    let isFirstParagraphAfterBreak = true;

    for (const block of blocks) {
      if (block.type === 'scenebreak') {
        if (cursorY + 14 > maxBodyY) {
          doc.addPage();
          cursorY = topMargin;
        } else {
          cursorY += 5;
          doc.setFont('times', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(100, 116, 139);
          doc.text('*   *   *', pageWidth / 2, cursorY, { align: 'center' });
          cursorY += 8;
        }
        isFirstParagraphAfterBreak = true;
        continue;
      }

      if (
        block.type === 'heading1' ||
        block.type === 'heading2' ||
        block.type === 'heading3'
      ) {
        const fontSize = block.type === 'heading1' ? 15 : block.type === 'heading2' ? 13.5 : 12;
        const lineHeight = 6.5;
        doc.setFont('times', 'bold');
        doc.setFontSize(fontSize);
        doc.setTextColor(15, 23, 42);

        const hLines: string[] = doc.splitTextToSize(block.text, contentWidth);
        const requiredHeight = hLines.length * lineHeight + 12;

        // Prevent orphaned headings at the bottom of a page
        if (cursorY + requiredHeight > maxBodyY) {
          doc.addPage();
          cursorY = topMargin;
        } else {
          cursorY += 5;
        }

        for (const hLine of hLines) {
          doc.text(hLine, marginX, cursorY);
          cursorY += lineHeight;
        }
        cursorY += 2.5;
        isFirstParagraphAfterBreak = true;
        continue;
      }

      if (block.type === 'quote') {
        doc.setFont('times', 'italic');
        doc.setFontSize(11);
        doc.setTextColor(51, 65, 85);
        const qLines: string[] = doc.splitTextToSize(block.text, contentWidth - 16);
        const lineHeight = 5.8;

        cursorY += 2;
        for (const qLine of qLines) {
          if (cursorY + lineHeight > maxBodyY) {
            doc.addPage();
            cursorY = topMargin;
            doc.setFont('times', 'italic');
            doc.setFontSize(11);
            doc.setTextColor(51, 65, 85);
          }
          doc.text(qLine, marginX + 8, cursorY);
          cursorY += lineHeight;
        }
        cursorY += 3;
        isFirstParagraphAfterBreak = true;
        continue;
      }

      // Standard Body Paragraph
      doc.setFont('times', 'normal');
      doc.setFontSize(11.5);
      doc.setTextColor(15, 23, 42);

      const lineHeight = 6.0;
      const indentPrefix = isFirstParagraphAfterBreak ? '' : '      ';
      const paraLines: string[] = doc.splitTextToSize(
        indentPrefix + block.text,
        contentWidth
      );

      // Avoid single-line orphan at the bottom of the page if paragraph has >= 2 lines
      if (paraLines.length >= 2 && cursorY + lineHeight * 2 > maxBodyY) {
        doc.addPage();
        cursorY = topMargin;
      }

      for (const pLine of paraLines) {
        if (cursorY + lineHeight > maxBodyY) {
          doc.addPage();
          cursorY = topMargin;
          doc.setFont('times', 'normal');
          doc.setFontSize(11.5);
          doc.setTextColor(15, 23, 42);
        }
        doc.text(pLine, marginX, cursorY);
        cursorY += lineHeight;
      }

      cursorY += 2.2; // Subtle paragraph spacing
      isFirstParagraphAfterBreak = false;
    }

    const chapterEndPage = doc.getNumberOfPages();
    chapterTocMeta.push({
      label: chap.chapterNumber === 0 ? 'Introduction' : `Chapter ${chap.chapterNumber}`,
      title: cleanChapTitle,
      startPage: chapterStartPage,
      endPage: chapterEndPage,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. POPULATE TABLE OF CONTENTS PAGES WITH EXACT PAGE NUMBERS & LINKS
  // ---------------------------------------------------------------------------
  for (let p = 0; p < numTocPages; p++) {
    const tocPageNum = tocStartPage + p;
    doc.setPage(tocPageNum);

    let tocY = 40;
    if (p === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(100, 116, 139);
      doc.text('CONTENTS', pageWidth / 2, tocY, { align: 'center' });
      tocY += 8;

      doc.setFont('times', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(15, 23, 42);
      doc.text('Table of Contents', pageWidth / 2, tocY, { align: 'center' });
      tocY += 6;

      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.35);
      doc.line(marginX, tocY, pageWidth - marginX, tocY);
      tocY += 12;
    } else {
      doc.setFont('times', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('Table of Contents (Continued)', pageWidth / 2, tocY, { align: 'center' });
      tocY += 12;
    }

    const sliceStart = p * tocEntriesPerPage;
    const sliceEntries = chapterTocMeta.slice(sliceStart, sliceStart + tocEntriesPerPage);

    for (const entry of sliceEntries) {
      const displayLeft = `${entry.label}: ${entry.title}`;
      const truncatedLeft =
        displayLeft.length > 62 ? displayLeft.slice(0, 59) + '...' : displayLeft;
      const pageNumStr = String(entry.startPage);

      doc.setFont('times', 'normal');
      doc.setFontSize(11.5);
      doc.setTextColor(15, 23, 42);
      doc.text(truncatedLeft, marginX, tocY);

      // Dot leader line
      const leftWidth = doc.getTextWidth(truncatedLeft);
      const rightWidth = doc.getTextWidth(pageNumStr);
      const dotsStartX = marginX + leftWidth + 3;
      const dotsEndX = pageWidth - marginX - rightWidth - 3;

      if (dotsEndX > dotsStartX + 4) {
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.2);
        doc.setLineDashPattern([0.6, 1.8], 0);
        doc.line(dotsStartX, tocY - 1, dotsEndX, tocY - 1);
        doc.setLineDashPattern([], 0);
      }

      doc.setFont('times', 'bold');
      doc.setTextColor(30, 58, 138);
      doc.text(pageNumStr, pageWidth - marginX, tocY, { align: 'right' });

      // Interactive PDF link to the chapter's starting page
      doc.link(marginX, tocY - 5, contentWidth, 7, { pageNumber: entry.startPage });

      tocY += 9.5;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. ADD RUNNING HEADERS & PAGE NUMBERS (FOLIOS) TO ALL CHAPTER PAGES
  // ---------------------------------------------------------------------------
  const totalPages = doc.getNumberOfPages();
  const firstChapterPage = chapterTocMeta[0]?.startPage || tocStartPage + numTocPages;
  const chapterOpeningPages = new Set(chapterTocMeta.map((m) => m.startPage));

  for (let pageNum = firstChapterPage; pageNum <= totalPages; pageNum++) {
    doc.setPage(pageNum);

    // Running Header on non-opening chapter pages
    if (!chapterOpeningPages.has(pageNum)) {
      const activeChap = chapterTocMeta.find(
        (m) => pageNum >= m.startPage && pageNum <= m.endPage
      );
      const headerRight = activeChap
        ? `${activeChap.label}: ${activeChap.title}`
        : cleanBookTitle;

      doc.setFont('times', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184);

      const shortBookTitle =
        cleanBookTitle.length > 38 ? cleanBookTitle.slice(0, 35) + '...' : cleanBookTitle;
      const shortChapTitle =
        headerRight.length > 42 ? headerRight.slice(0, 39) + '...' : headerRight;

      doc.text(shortBookTitle, marginX, 16);
      doc.text(shortChapTitle, pageWidth - marginX, 16, { align: 'right' });

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(marginX, 18.5, pageWidth - marginX, 18.5);
    }

    // Bottom Page Number (Folio)
    doc.setFont('times', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`- ${pageNum} -`, pageWidth / 2, pageHeight - 13, { align: 'center' });
  }

  // Save PDF
  const safeFilename =
    (outline.title || 'Manuscript')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 40) || 'Ebook_AI_Manuscript';

  doc.save(`${safeFilename}.pdf`);
}
