import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { fromBufferPromise } from 'yauzl';
import { normalizeEmployeeIdentifier } from '../src/modules/workforce/employee-import';
import { readEmployeeWorkbook } from '../src/modules/workforce/employee-workbook';
import { fixtureWorkbook, fixtureWorkbookParts, zipFixture } from './workforce-workbook.fixture';

const validRow: [string, string, string, string] = [
  '0001',
  'Ana Silva',
  'Unit alpha',
  'Sector alpha',
];
const sheet = 'xl/worksheets/import.xml';
const readWorkbook = (buffer: Buffer) =>
  readEmployeeWorkbook({ originalname: 'modelo.xlsx', buffer });

describe('Excel staff workbook', () => {
  it('preserves textual registrations and resolves compatibility-equivalent duplicate keys', async () => {
    const registration = fc.stringOf(fc.constantFrom(...'0123456789ABCD'), {
      minLength: 1,
      maxLength: 22,
    });
    const fullWidth = (value: string) =>
      Array.from(value.toLowerCase(), (character) =>
        String.fromCharCode(character.charCodeAt(0) + 0xfee0),
      ).join('');
    await fc.assert(
      fc.asyncProperty(registration, fc.integer({ min: 1, max: 20 }), async (suffix, zeros) => {
        const literal = '0'.repeat(zeros) + suffix;
        const equivalent = fullWidth(literal);
        const rows = await readWorkbook(
          fixtureWorkbook([
            [literal, 'João & Irene', 'Unidade < A', 'Setor 01'],
            [equivalent, 'Lígia Costa', 'Unidade < A', 'Setor 01'],
          ]),
        );
        expect(rows.map(({ cells }) => cells.Matrícula)).toEqual([literal, equivalent]);
        expect(rows[0]?.cells).toMatchObject({ Nome: 'João & Irene', Unidade: 'Unidade < A' });
        expect(normalizeEmployeeIdentifier(equivalent)).toBe(normalizeEmployeeIdentifier(literal));
      }),
      { numRuns: 40 },
    );
  });
  it('reads a filled version of the official template with styled cells and its auxiliary sheet', async () => {
    const template = await readFile(
      resolve(__dirname, '../../web/public/modelo-colaboradores.xlsx'),
    );
    await expect(readWorkbook(template)).rejects.toMatchObject({
      response: {
        details: [{ field: 'file', message: expect.stringMatching(/pelo menos uma linha/) }],
      },
    });
    const parts: Record<string, Buffer | string> = {};
    const zip = await fromBufferPromise(template, { autoClose: false });
    try {
      for await (const entry of zip.eachEntry()) {
        const chunks: Buffer[] = [];
        for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
        parts[entry.fileName] = Buffer.concat(chunks);
      }
    } finally {
      zip.close();
    }
    const partsSheet = 'xl/worksheets/sheet1.xml';
    const populated =
      '<x:row r="2">' +
      validRow
        .map((value, column) => `<x:c r="${'ABCD'[column]}2" t="str"><x:v>${value}</x:v></x:c>`)
        .join('') +
      '</x:row>';
    parts[partsSheet] = String(parts[partsSheet]).replace(/<x:row r="2">.*?<\/x:row>/, populated);
    await expect(readWorkbook(zipFixture(parts))).resolves.toEqual([
      {
        row: 2,
        cells: {
          Matrícula: '0001',
          Nome: 'Ana Silva',
          Unidade: 'Unit alpha',
          Setor: 'Sector alpha',
        },
        extraColumns: false,
      },
    ]);
  });
  it('reads shared text but marks numeric and formula cells invalid, including cached formulas', async () => {
    const parts: Record<string, Buffer | string> = fixtureWorkbookParts([
      validRow,
      validRow,
      validRow,
    ]);
    parts['xl/_rels/workbook.xml.rels'] = String(parts['xl/_rels/workbook.xml.rels']).replace(
      '</Relationships>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    );
    parts['xl/sharedStrings.xml'] =
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>00</t></r><r><t>01</t></r></si></sst>';
    parts[sheet] = String(parts[sheet])
      .replace(/<c r="A2".*?<\/c>/, '<c r="A2" t="s"><v>0</v></c>')
      .replace(/<c r="A3".*?<\/c>/, '<c r="A3"><v>1</v></c>')
      .replace(/<c r="A4".*?<\/c>/, '<c r="A4" t="str"><f>"0001"</f><v>0001</v></c>');
    const rows = await readWorkbook(zipFixture(parts));
    expect(rows.map(({ cells }) => cells.Matrícula)).toEqual(['0001', null, null]);
  });
  it('rejects ambiguous cells that contain multiple values or a value inconsistent with the declared type', async () => {
    const parts = fixtureWorkbookParts([validRow, validRow]);
    parts[sheet] = parts[sheet]
      .replace(/<c r="A2".*?<\/c>/, '<c r="A2" t="str"><v>00</v><v>01</v></c>')
      .replace(/<c r="A3".*?<\/c>/, '<c r="A3" t="inlineStr"><v>0001</v></c>');
    const rows = await readWorkbook(zipFixture(parts));
    expect(rows.map(({ cells }) => cells.Matrícula)).toEqual([null, null]);
  });
  it('rejects the reference alias ID, sensitive columns, external XML and oversized expanded ZIP parts', async () => {
    const alias = fixtureWorkbookParts([validRow], ['ID', 'Nome', 'Unidade', 'Setor']);
    const external = fixtureWorkbookParts([validRow]);
    external[sheet] = '<!DOCTYPE worksheet SYSTEM "file:///must-not-read">' + external[sheet];
    const compressedBomb = {
      ...fixtureWorkbookParts([validRow]),
      'ignored.xml': ' '.repeat(4 * 1024 * 1024 + 1),
    };
    const sensitive = fixtureWorkbookParts([validRow]);
    sensitive[sheet] = sensitive[sheet].replace('</row>', '<c r="E1" t="str"><v>CPF</v></c></row>');
    for (const parts of [alias, external, compressedBomb, sensitive])
      await expect(readWorkbook(zipFixture(parts))).rejects.toMatchObject({ status: 400 });
  });
  it('bounds the number of filled rows at 500', async () => {
    await expect(
      readWorkbook(zipFixture(fixtureWorkbookParts(Array.from({ length: 500 }, () => validRow)))),
    ).resolves.toHaveLength(500);
    await expect(
      readWorkbook(zipFixture(fixtureWorkbookParts(Array.from({ length: 501 }, () => validRow)))),
    ).rejects.toMatchObject({ status: 400 });
  });
});
