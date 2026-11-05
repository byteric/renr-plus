import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import PDFDocument from 'pdfkit';
import { reportSnapshotSchema, type ReportSnapshot, type ReportSection } from '@renr/contracts';

export const REPORT_PDF_LIMITS = {
  pages: 250,
  bytes: 25 * 1024 * 1024,
  inputBytes: 4 * 1024 * 1024,
  milliseconds: 30_000,
} as const;
export class ReportPdfLimitError extends Error {
  readonly code = 'REPORT_PDF_LIMIT';
  constructor(message: string) {
    super(message);
    this.name = 'ReportPdfLimitError';
  }
}
/** Limits can only tighten the production ceiling. Deadline uses epoch milliseconds. */
export interface ReportPdfOptions {
  deadline?: number;
  maxPages?: number;
  maxBytes?: number;
  now?: () => number;
}
const assets = resolve(__dirname, '../../../assets/reports');
const regular = readFileSync(resolve(assets, 'Manrope-Regular.ttf'));
const bold = readFileSync(resolve(assets, 'Manrope-Bold.ttf'));
const logo = readFileSync(resolve(assets, 'renr-plus-logo.svg'), 'utf8');
const COLORS = {
  ink: '#173E3A',
  green: '#579277',
  accent: '#D5E7A3',
  paper: '#F7F8F2',
  rule: '#CFDAD2',
  muted: '#48645C',
};
const LEFT = 40,
  WIDTH = 515.28,
  BODY_TOP = 86,
  BODY_END = 782,
  LINE = 14,
  CELL_PADDING = 7;

export async function renderReportPdf(
  snapshot: ReportSnapshot,
  options: ReportPdfOptions = {},
): Promise<Buffer> {
  const now = options.now ?? Date.now;
  const deadline = Math.min(options.deadline ?? Infinity, now() + REPORT_PDF_LIMITS.milliseconds);
  const maxPages = Math.min(options.maxPages ?? REPORT_PDF_LIMITS.pages, REPORT_PDF_LIMITS.pages);
  const maxBytes = Math.min(options.maxBytes ?? REPORT_PDF_LIMITS.bytes, REPORT_PDF_LIMITS.bytes);
  if (
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    Number.isNaN(deadline)
  )
    throw new ReportPdfLimitError('Limites do PDF inválidos.');
  const check = () => {
    if (now() >= deadline)
      throw new ReportPdfLimitError('Limite de tempo do PDF atingido. Reduza o recorte.');
  };
  check();
  // Bound serialized input before PDFKit allocates page streams or font subsets.
  let inputBytes = 0;
  const account = (value: string) => {
    inputBytes += Buffer.byteLength(value, 'utf8');
    check();
    if (inputBytes > REPORT_PDF_LIMITS.inputBytes)
      throw new ReportPdfLimitError('Limite de conteúdo do PDF atingido. Reduza o recorte.');
  };
  for (const value of [
    snapshot.title,
    snapshot.context,
    snapshot.timeZone,
    ...snapshot.limitations,
  ])
    account(value);
  for (const filter of snapshot.filters) {
    account(filter.label);
    account(filter.value);
  }
  for (const section of snapshot.sections) {
    account(section.title);
    for (const value of [...section.columns, ...section.notes]) account(value);
    for (const row of section.rows) {
      if (row.length !== section.columns.length)
        throw new Error('Linha do relatório incompatível com as colunas.');
      for (const value of row) account(value);
    }
  }
  reportSnapshotSchema.parse(snapshot);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    info: {
      Title: snapshot.title,
      Author: 'ReNR+',
      Subject: snapshot.context,
      CreationDate: new Date(snapshot.createdAt),
    },
  });
  doc.registerFont('Body', regular);
  doc.registerFont('Heading', bold);
  const stream = doc as unknown as Readable;
  const chunks: Buffer[] = [];
  let bytes = 0,
    page = 0,
    y = BODY_TOP;
  const complete = new Promise<Buffer>((accept, reject) => {
    doc.on('data', (chunk: Buffer) => {
      try {
        check();
      } catch (error) {
        stream.destroy(error as Error);
        return;
      }
      bytes += chunk.length;
      if (bytes > maxBytes)
        stream.destroy(
          new ReportPdfLimitError('Limite de tamanho do PDF atingido. Reduza o recorte.'),
        );
      else chunks.push(chunk);
    });
    doc.once('error', reject);
    doc.once('end', () => accept(Buffer.concat(chunks, bytes)));
  });
  // Observe stream failures even when synchronous layout throws before awaiting completion.
  void complete.catch(() => undefined);
  const text = (
    value: string,
    x: number,
    top: number,
    size = 9,
    font = 'Body',
    color = COLORS.ink,
  ) => {
    check();
    doc.font(font).fontSize(size).fillColor(color).text(value, x, top, { lineBreak: false });
  };
  const wrap = (value: string, width: number, size = 9, font = 'Body'): string[] => {
    doc.font(font).fontSize(size);
    const lines: string[] = [];
    for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/u)) {
        check();
        if (!word) continue;
        const candidate = line ? line + ' ' + word : word;
        if (word.length <= 256 && doc.widthOfString(candidate) <= width) {
          line = candidate;
          continue;
        }
        if (line) {
          lines.push(line);
          line = '';
        }
        const characters = Array.from(word);
        let offset = 0;
        while (offset < characters.length) {
          check();
          const remaining = characters.slice(offset, offset + 256);
          if (
            offset + remaining.length === characters.length &&
            doc.widthOfString(remaining.join('')) <= width
          ) {
            line = remaining.join('');
            break;
          }
          let low = 1,
            high = remaining.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (doc.widthOfString(remaining.slice(0, middle).join('')) <= width) low = middle;
            else high = middle - 1;
          }
          lines.push(remaining.slice(0, low).join(''));
          offset += low;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const drawLogo = () => {
    doc
      .save()
      .translate(LEFT, 24)
      .scale(112 / 816);
    for (const group of logo.matchAll(
      /<g\b[^>]*transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)"[^>]*>([\s\S]*?)<\/g>/g,
    )) {
      doc.save().translate(Number(group[1]), Number(group[2])).scale(Number(group[3]));
      for (const path of group[4]!.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/>/g))
        doc.path(path[1]!).fill(COLORS.ink, 'even-odd');
      doc.restore();
    }
    doc.restore();
  };
  const newPage = () => {
    check();
    if (page >= maxPages)
      throw new ReportPdfLimitError('Limite de páginas do PDF atingido. Reduza o recorte.');
    doc.addPage();
    page++;
    y = BODY_TOP;
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.paper);
    drawLogo();
    text(
      'RELATÓRIO / ' +
        { PEOPLE: 'GESTÃO DE PESSOAS', SST: 'SAÚDE E SEGURANÇA', PLATFORM: 'PLATAFORMA' }[
          snapshot.kind
        ],
      296,
      35,
      8,
      'Heading',
      COLORS.muted,
    );
    doc
      .moveTo(LEFT, 68)
      .lineTo(LEFT + WIDTH, 68)
      .lineWidth(1)
      .stroke(COLORS.rule);
  };
  const paragraph = (value: string, size = 10, font = 'Body', gap = 8) => {
    const lineHeight = size * 1.45;
    for (const line of wrap(value, WIDTH, size, font)) {
      if (y + lineHeight > BODY_END) newPage();
      text(line, LEFT, y, size, font);
      y += lineHeight;
    }
    y += gap;
  };
  const table = (section: ReportSection, sectionIndex: number) => {
    const columnWidth = WIDTH / section.columns.length;
    const headings = section.columns.map((column) =>
      wrap(column, columnWidth - 2 * CELL_PADDING, 9, 'Heading'),
    );
    const headingHeight =
      Math.max(...headings.map((lines) => lines.length)) * LINE + 2 * CELL_PADDING;
    if (headingHeight > 200)
      throw new ReportPdfLimitError('Limite de altura dos cabeçalhos atingido. Reduza o recorte.');
    const titleLines = wrap(section.title, WIDTH, 14, 'Heading');
    if (y + Math.min(titleLines.length, 3) * 21 + headingHeight + 30 > BODY_END) newPage();
    paragraph(section.title, 14, 'Heading', 9);
    const header = (continuation = false) => {
      if (continuation) {
        const repeated = titleLines.length <= 3 ? titleLines : [`Seção ${sectionIndex + 1}`];
        for (const line of repeated) {
          text(line, LEFT, y, 14, 'Heading');
          y += 21;
        }
        text('Continuação', LEFT, y, 8, 'Body', COLORS.muted);
        y += 19;
      }
      if (y + headingHeight + LINE + 2 * CELL_PADDING > BODY_END) newPage();
      doc.rect(LEFT, y, WIDTH, headingHeight).fill(COLORS.ink);
      headings.forEach((lines, index) =>
        lines.forEach((line, n) =>
          text(
            line,
            LEFT + index * columnWidth + CELL_PADDING,
            y + CELL_PADDING + n * LINE,
            9,
            'Heading',
            COLORS.paper,
          ),
        ),
      );
      y += headingHeight;
    };
    header();
    section.rows.forEach((row, rowIndex) => {
      const cells = row.map((cell) => wrap(cell, columnWidth - 2 * CELL_PADDING));
      const lineCount = Math.max(1, ...cells.map((lines) => lines.length));
      let offset = 0;
      while (offset < lineCount) {
        check();
        let available = Math.floor((BODY_END - y - 2 * CELL_PADDING) / LINE);
        if (available < 1) {
          newPage();
          header(true);
          available = Math.floor((BODY_END - y - 2 * CELL_PADDING) / LINE);
        }
        const count = Math.min(lineCount - offset, available),
          height = count * LINE + 2 * CELL_PADDING;
        doc.rect(LEFT, y, WIDTH, height).fill(rowIndex % 2 === 0 ? '#FFFFFF' : '#EDF2E9');
        cells.forEach((lines, index) =>
          lines
            .slice(offset, offset + count)
            .forEach((line, n) =>
              text(line, LEFT + index * columnWidth + CELL_PADDING, y + CELL_PADDING + n * LINE),
            ),
        );
        doc
          .moveTo(LEFT, y + height)
          .lineTo(LEFT + WIDTH, y + height)
          .lineWidth(0.5)
          .stroke(COLORS.rule);
        y += height;
        offset += count;
      }
    });
    y += 10;
    if (!section.rows.length) paragraph('Nenhum registro no recorte.', 9);
    for (const note of section.notes) paragraph('Nota: ' + note, 9);
    y += 8;
  };
  try {
    newPage();
    paragraph(snapshot.title, 25, 'Heading', 10);
    paragraph(snapshot.context, 12, 'Heading', 12);
    paragraph(`Referência: ${snapshot.referenceDate} | Fuso: ${snapshot.timeZone}`, 9, 'Body', 4);
    paragraph(`Gerado em: ${snapshot.createdAt} | Snapshot: ${snapshot.id}`, 8, 'Body', 12);
    if (snapshot.financial) paragraph('CONTÉM DADOS FINANCEIROS', 9, 'Heading', 8);
    if (snapshot.nominal) paragraph('CONTÉM DADOS NOMINAIS', 9, 'Heading', 8);
    for (const filter of snapshot.filters)
      paragraph(`${filter.label}: ${filter.value}`, 9, 'Body', 3);
    y += 15;
    snapshot.sections.forEach(table);
    if (snapshot.limitations.length) {
      if (y + 52 > BODY_END) newPage();
      paragraph('Notas e limitações', 14, 'Heading', 8);
      for (const limitation of snapshot.limitations) paragraph(limitation, 9);
    }
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index++) {
      check();
      doc.switchToPage(index);
      doc
        .moveTo(LEFT, 799)
        .lineTo(LEFT + WIDTH, 799)
        .lineWidth(0.5)
        .stroke(COLORS.green);
      text('ReNR+ / Uso restrito ao contexto autorizado', LEFT, 809, 8, 'Body', COLORS.muted);
      text(`Página ${index + 1} de ${range.count}`, 455, 809, 8, 'Heading');
    }
    check();
    doc.end();
    const buffer = await complete;
    check();
    return buffer;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
