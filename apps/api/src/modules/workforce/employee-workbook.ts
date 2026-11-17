import { BadRequestException } from '@nestjs/common';
import { crc32 } from 'node:zlib';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { fromBufferPromise, type Entry } from 'yauzl';

export const employeeWorkbookFileLimit = 1024 * 1024;
const rowLimit = 500;
const maxWorksheetRow = 1_048_576;
const maxPartSize = 4 * 1024 * 1024;
const maxArchiveSize = 16 * 1024 * 1024;
const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const strictSheetNamespace = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
const relNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const strictRelNamespace = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
const packageRels = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types';
const workbookContentType =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const fields = ['Matrícula', 'Nome', 'Unidade', 'Setor'] as const;
type Field = (typeof fields)[number];
type WorkbookCell = string | null;
export type EmployeeWorkbookRow = {
  row: number;
  cells: Partial<Record<Field, WorkbookCell>>;
  extraColumns: boolean;
};

const invalidWorkbook = (message: string) =>
  new BadRequestException({ details: [{ field: 'file', message }] });
const malformed = () =>
  invalidWorkbook('Envie um arquivo .xlsx válido com a aba Colaboradores do modelo.');
const attr = (tag: SaxesTagNS, name: string) => tag.attributes[name]?.value;
const spreadsheet = (tag: SaxesTagNS | undefined, name: string) =>
  tag?.local === name && (tag.uri === sheetNamespace || tag.uri === strictSheetNamespace);

function xml(
  document: string,
  open: (stack: readonly SaxesTagNS[]) => void,
  close?: (stack: readonly SaxesTagNS[]) => void,
  consumeText?: (value: string, stack: readonly SaxesTagNS[]) => void,
) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: SaxesTagNS[] = [];
  parser.on('doctype', () => {
    throw malformed();
  });
  parser.on('opentag', (tag) => {
    if (stack.length >= 32) throw malformed();
    stack.push(tag);
    open(stack);
  });
  parser.on('closetag', () => {
    close?.(stack);
    stack.pop();
  });
  parser.on('text', (value) => consumeText?.(value, stack));
  parser.on('cdata', (value) => consumeText?.(value, stack));
  parser.write(document).close();
}

function workbookSheetId(document: string) {
  let sheetId: string | undefined;
  xml(document, ([root, parent, tag, ...nested]) => {
    if (!spreadsheet(root, 'workbook')) throw malformed();
    if (
      !tag ||
      nested.length ||
      !spreadsheet(parent, 'sheets') ||
      !spreadsheet(tag, 'sheet') ||
      attr(tag, 'name') !== 'Colaboradores'
    )
      return;
    const id = Object.values(tag.attributes).find(
      ({ local, uri }) => local === 'id' && [relNamespace, strictRelNamespace].includes(uri),
    )?.value;
    if (sheetId || !id) throw malformed();
    sheetId = id;
  });
  if (!sheetId) throw malformed();
  return sheetId;
}

function workbookParts(document: string, sheetId: string) {
  let worksheet: string | undefined;
  let sharedStrings: string | undefined;
  xml(document, ([root, tag, ...nested]) => {
    if (root?.uri !== packageRels || root.local !== 'Relationships') throw malformed();
    if (!tag || nested.length || tag.uri !== packageRels || tag.local !== 'Relationship') return;
    const id = attr(tag, 'Id');
    const kind = attr(tag, 'Type');
    const target = attr(tag, 'Target');
    const linkKind = (name: string) =>
      kind === `${relNamespace}/${name}` || kind === `${strictRelNamespace}/${name}`;
    const resolve = (allowed: RegExp) => {
      if (!target || (attr(tag, 'TargetMode') ?? 'Internal') !== 'Internal') throw malformed();
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      if (!allowed.test(path)) throw malformed();
      return path;
    };
    if (id === sheetId) {
      if (worksheet || !linkKind('worksheet')) throw malformed();
      worksheet = resolve(/^xl\/worksheets\/[\w.-]+\.xml$/);
    }
    if (linkKind('sharedStrings')) {
      if (sharedStrings) throw malformed();
      sharedStrings = resolve(/^xl\/[\w.-]+\.xml$/);
    }
  });
  if (!worksheet) throw malformed();
  return { worksheet, sharedStrings };
}

function textPath(stack: readonly SaxesTagNS[], start: number) {
  return (
    (stack.length === start + 1 && spreadsheet(stack[start], 't')) ||
    (stack.length === start + 2 &&
      spreadsheet(stack[start], 'r') &&
      spreadsheet(stack[start + 1], 't'))
  );
}

function readSharedStrings(document: string) {
  const values: string[] = [];
  let value = '';
  xml(
    document,
    ([root, child, ...nested]) => {
      if (!spreadsheet(root, 'sst')) throw malformed();
      if (child && !nested.length && spreadsheet(child, 'si')) value = '';
    },
    ([, child, ...nested]) => {
      if (!child || nested.length || !spreadsheet(child, 'si')) return;
      if (values.length >= 50_000) throw malformed();
      values.push(value);
    },
    (chunk, stack) => {
      if (stack.length >= 3 && spreadsheet(stack[1], 'si') && textPath(stack, 2)) value += chunk;
    },
  );
  return values;
}

function readRows(document: string, strings: string[]): EmployeeWorkbookRow[] {
  const data: EmployeeWorkbookRow[] = [];
  const headers = new Map<number, Field>();
  const occupied = new Map<number, WorkbookCell>();
  const coordinates = new Set<number>();
  let row = 0;
  let column = 0;
  let cell = { type: '', text: '', values: 0, invalid: false };
  xml(
    document,
    ([root, sheetData, rowTag, cellTag, child, ...nested]) => {
      if (!spreadsheet(root, 'worksheet')) throw malformed();
      if (!rowTag || !spreadsheet(sheetData, 'sheetData') || !spreadsheet(rowTag, 'row')) return;
      if (!cellTag) {
        const raw = attr(rowTag, 'r');
        const next = raw === undefined ? row + 1 : Number(raw);
        if (!Number.isInteger(next) || next <= row || next > maxWorksheetRow) throw malformed();
        row = next;
        column = 0;
        occupied.clear();
        coordinates.clear();
      } else if (spreadsheet(cellTag, 'c') && !child) {
        const reference = attr(cellTag, 'r');
        if (reference === undefined) {
          column++;
        } else {
          const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(reference);
          if (!match?.[1] || Number(match[2]) !== row) throw malformed();
          column = [...match[1]].reduce(
            (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
            0,
          );
        }
        if (column > 16_384 || coordinates.has(column)) throw malformed();
        coordinates.add(column);
        cell = { type: attr(cellTag, 't') ?? 'n', text: '', values: 0, invalid: false };
      } else if (spreadsheet(cellTag, 'c') && child && !nested.length) {
        if (spreadsheet(child, 'f')) cell.invalid = true;
        const inline = spreadsheet(child, 'is');
        if (spreadsheet(child, 'v') || inline) {
          cell.values++;
          if (cell.values > 1 || inline !== (cell.type === 'inlineStr')) cell.invalid = true;
        }
      }
    },
    ([, sheetData, rowTag, cellTag, ...nested]) => {
      if (!rowTag || !spreadsheet(sheetData, 'sheetData') || !spreadsheet(rowTag, 'row')) return;
      if (cellTag) {
        if (nested.length || !spreadsheet(cellTag, 'c') || (!cell.invalid && !cell.values)) return;
        let value: WorkbookCell = null;
        if (!cell.invalid) {
          if (cell.type === 's') {
            const index = /^\d+$/.test(cell.text) ? Number(cell.text) : -1;
            value = strings[index] ?? null;
          } else if (cell.type === 'inlineStr' || cell.type === 'str') {
            value = cell.text;
          } else if (cell.text.length === 0 && cell.type === 'n') {
            value = '';
          }
        }
        if (value === null || value.trim()) occupied.set(column, value);
        return;
      }
      if (row === 1) {
        for (const [index, value] of occupied) {
          const field = fields.find((candidate) => candidate === value);
          if (field) headers.set(index, field);
        }
        if (occupied.size !== fields.length || new Set(headers.values()).size !== fields.length)
          throw invalidWorkbook(
            'O cabeçalho deve conter exatamente Matrícula, Nome, Unidade e Setor.',
          );
      } else if (occupied.size) {
        const cells: EmployeeWorkbookRow['cells'] = {};
        let extraColumns = false;
        for (const [index, value] of occupied) {
          const field = headers.get(index);
          if (field) cells[field] = value;
          else extraColumns = true;
        }
        data.push({ row, cells, extraColumns });
        if (data.length > rowLimit)
          throw invalidWorkbook('A planilha pode conter até 500 linhas preenchidas.');
      }
    },
    (chunk, stack) => {
      if (
        stack.length < 5 ||
        !spreadsheet(stack[1], 'sheetData') ||
        !spreadsheet(stack[2], 'row') ||
        !spreadsheet(stack[3], 'c')
      )
        return;
      const valueElement = stack.length === 5 && spreadsheet(stack[4], 'v');
      const inlineText = spreadsheet(stack[4], 'is') && textPath(stack, 5);
      if (valueElement || inlineText) cell.text += chunk;
    },
  );
  if (headers.size !== fields.length)
    throw invalidWorkbook('Preencha o cabeçalho na primeira linha da aba Colaboradores.');
  if (!data.length) throw invalidWorkbook('Preencha pelo menos uma linha na aba Colaboradores.');
  return data;
}

export async function readEmployeeWorkbook(
  file: { originalname: string; buffer: Buffer } | undefined,
): Promise<EmployeeWorkbookRow[]> {
  if (
    !file ||
    !/\.xlsx$/i.test(file.originalname) ||
    file.buffer.length < 4 ||
    file.buffer.length > employeeWorkbookFileLimit ||
    file.buffer.readUInt32LE(0) !== 0x04034b50
  )
    throw malformed();
  try {
    const zip = await fromBufferPromise(file.buffer, {
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    try {
      const entries = new Map<string, Entry>();
      let totalSize = 0;
      if (zip.entryCount > 128) throw malformed();
      for await (const entry of zip.eachEntry()) {
        totalSize += entry.uncompressedSize;
        if (
          entries.has(entry.fileName) ||
          entry.uncompressedSize > maxPartSize ||
          totalSize > maxArchiveSize
        )
          throw malformed();
        entries.set(entry.fileName, entry);
      }
      const read = async (path: string) => {
        const entry = entries.get(path);
        if (!entry) throw malformed();
        const chunks: Buffer[] = [];
        for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (crc32(buffer) !== entry.crc32) throw malformed();
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      };
      let defaultXmlType: string | undefined;
      let workbookType: string | undefined;
      xml(await read('[Content_Types].xml'), ([root, tag, ...nested]) => {
        if (root?.uri !== contentTypes || root.local !== 'Types') throw malformed();
        if (tag?.uri !== contentTypes || nested.length) return;
        if (tag.local === 'Default' && attr(tag, 'Extension')?.toLowerCase() === 'xml') {
          if (defaultXmlType) throw malformed();
          defaultXmlType = attr(tag, 'ContentType');
          if (!defaultXmlType) throw malformed();
        }
        if (tag.local === 'Override' && attr(tag, 'PartName') === '/xl/workbook.xml') {
          if (workbookType) throw malformed();
          workbookType = attr(tag, 'ContentType');
          if (!workbookType) throw malformed();
        }
      });
      if ((workbookType ?? defaultXmlType) !== workbookContentType) throw malformed();
      const id = workbookSheetId(await read('xl/workbook.xml'));
      const { worksheet, sharedStrings } = workbookParts(
        await read('xl/_rels/workbook.xml.rels'),
        id,
      );
      const strings = sharedStrings ? readSharedStrings(await read(sharedStrings)) : [];
      return readRows(await read(worksheet), strings);
    } finally {
      zip.close();
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw malformed();
  }
}
