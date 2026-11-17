import { crc32, deflateRawSync } from 'node:zlib';

export function zipFixture(parts: Record<string, string | Buffer>) {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(parts)) {
    const fileName = Buffer.from(name);
    const content = Buffer.from(contents);
    const compressed = deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    files.push(local, fileName, compressed);
    directory.push(central, fileName);
    offset += local.length + fileName.length + compressed.length;
  }
  const entries = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(entries.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, entries, end]);
}

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationship = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentType = 'http://schemas.openxmlformats.org/package/2006/content-types';
const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const textCell = (ref: string, value: string) =>
  `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const header = (fields: string[]) =>
  fields.map((field, index) => textCell(`${'ABCD'[index]}1`, field)).join('');
type Row = [string, string, string, string];

export function fixtureWorkbookParts(
  rows: Row[],
  fields = ['Matrícula', 'Nome', 'Unidade', 'Setor'],
) {
  const data = rows.map((row, index) => {
    const number = index + 2;
    const cells = row.map((value, column) => textCell(`${'ABCD'[column]}${number}`, value));
    return `<row r="${number}">${cells.join('')}</row>`;
  });
  return {
    '[Content_Types].xml': `<Types xmlns="${contentType}"><Override PartName="/xl/workbook.xml" ContentType="${workbookType}"/></Types>`,
    'xl/workbook.xml': `<workbook xmlns="${main}" xmlns:r="${relationship}"><sheets><sheet name="Colaboradores" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageRelationship}"><Relationship Id="rId1" Type="${relationship}/worksheet" Target="worksheets/import.xml"/></Relationships>`,
    'xl/worksheets/import.xml': `<worksheet xmlns="${main}"><sheetData><row r="1">${header(fields)}</row>${data.join('')}</sheetData></worksheet>`,
  };
}

export const fixtureWorkbook = (rows: Row[]) => zipFixture(fixtureWorkbookParts(rows));
