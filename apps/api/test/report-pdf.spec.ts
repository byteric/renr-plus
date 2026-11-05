import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReportSnapshot } from '@renr/contracts';
import { renderReportPdf } from '../src/modules/reports/report-pdf';

const inspect = (
  buffer: Buffer,
): {
  pages: { text: string; width: number; height: number }[];
  embedded: boolean;
  fonts: string[];
} => {
  const script = `import io,json,sys
from pypdf import PdfReader
r=PdfReader(io.BytesIO(sys.stdin.buffer.read()))
fonts=[]
embedded=[]
for p in r.pages:
 for f in p['/Resources'].get('/Font',{}).get_object().values():
  f=f.get_object()
  fonts.append(str(f.get('/BaseFont','')))
  for d in f.get('/DescendantFonts',[f]):
   descriptor=d.get_object().get('/FontDescriptor')
   if descriptor:
    descriptor=descriptor.get_object()
    embedded.append('/FontFile2' in descriptor or '/FontFile3' in descriptor)
print(json.dumps({'pages':[{'text':p.extract_text(),'width':float(p.mediabox.width),'height':float(p.mediabox.height)} for p in r.pages],'embedded':bool(embedded) and all(embedded),'fonts':fonts}))`;
  const result = spawnSync(process.env.PDF_TEST_PYTHON ?? 'python', ['-c', script], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString());
};
const snapshot = (rows: string[][]): ReportSnapshot => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'PEOPLE',
  organizationId: '22222222-2222-4222-8222-222222222222',
  financial: false,
  nominal: false,
  createdAt: '2026-11-04T12:00:00.000Z',
  referenceDate: '2026-11-04',
  timeZone: 'America/Sao_Paulo',
  title: 'Gestão de Pessoas - panorama',
  context: 'Organização sintética / Unidade Recife',
  filters: [
    { label: 'Situação', value: 'Ativos' },
    { label: 'Competência', value: '2026-11' },
  ],
  sections: [
    {
      key: 'people',
      title: 'Pessoas e cobertura',
      columns: ['Registro', 'Descrição', 'Situação'],
      rows,
      notes: ['Cobertura considera registros ativos.'],
    },
  ],
  limitations: [
    'LIMITACAO_FINAL: estimativa para acompanhamento; dados ausentes permanecem desconhecidos.',
  ],
});

describe('Report snapshot PDF', () => {
  it('renders compact A4 with embedded Manrope, contextual metadata and complete content', async () => {
    const document = inspect(
      await renderReportPdf(
        snapshot([
          ['Pessoa sintética', 'Descrição com acentuação: férias, gênero e vínculo.', 'Conhecido'],
        ]),
      ),
    );
    expect(document.pages.length).toBeLessThanOrEqual(2);
    expect(document.pages[0]!.width).toBeCloseTo(595.28, 1);
    expect(document.pages[0]!.height).toBeCloseTo(841.89, 1);
    expect(document.embedded).toBe(true);
    expect(document.fonts.some((name) => name.includes('Manrope'))).toBe(true);
    const text = document.pages.map((p) => p.text).join('\n');
    for (const value of [
      'Gestão de Pessoas',
      'Unidade Recife',
      '2026-11-04',
      'America/Sao_Paulo',
      'Ativos',
      'férias',
      'LIMITACAO_FINAL',
    ])
      expect(text).toContain(value);
  });
  it('flows very long cells across pages and repeats table headers without losing any row', async () => {
    const rows = Array.from({ length: 180 }, (_, index) => [
      `REGISTRO_${String(index).padStart(4, '0')}`,
      index === 0
        ? 'Descrição longa com evidência verificável. '.repeat(400) + 'FIM_DESCRICAO_LONGA'
        : `Informação completa do registro ${index}.`,
      'Conhecido',
    ]);
    const buffer = await renderReportPdf(snapshot(rows));
    const document = inspect(buffer),
      text = document.pages.map((p) => p.text).join('\n');
    expect(document.pages.length).toBeGreaterThan(5);
    for (const row of rows) expect(text.replace(/\s/g, '')).toContain(row[0]);
    expect(text.replace(/\s/g, '')).toContain('FIM_DESCRICAO_LONGA');
    for (let index = 1; index < document.pages.length - 1; index++) {
      expect(document.pages[index]!.text).toContain('Registro');
      expect(document.pages[index]!.text).toContain('Descrição');
      expect(document.pages[index]!.text.replace(/\s/g, '').length).toBeGreaterThan(120);
    }
    expect(document.pages.at(-1)!.text).toContain('LIMITACAO_FINAL');
    if (process.env.WRITE_REPORT_PDF_FIXTURES === '1') {
      const directory = resolve(__dirname, '../../../tmp/pdfs');
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, 'report-long.pdf'), buffer);
    }
  });
  it('rejects the complete export instead of truncating when page budget is exhausted', async () => {
    await expect(
      renderReportPdf(
        snapshot(
          Array.from({ length: 100 }, (_, i) => [String(i), 'Texto longo '.repeat(50), 'Ativo']),
        ),
        { maxPages: 2 },
      ),
    ).rejects.toThrow(/limite/i);
  });
  it('checks the deadline during synchronous rendering', async () => {
    let tick = 0;
    await expect(
      renderReportPdf(snapshot([['Registro', 'Descrição', 'Ativo']]), {
        deadline: 5,
        now: () => tick++,
      }),
    ).rejects.toThrow(/prazo|tempo|limite/i);
  });
  it('rejects oversized buffers and oversized input instead of returning partial content', async () => {
    await expect(
      renderReportPdf(snapshot([['Registro', 'Descrição', 'Ativo']]), { maxBytes: 500 }),
    ).rejects.toThrow(/limite/i);
    await expect(
      renderReportPdf(snapshot([['Registro', 'x'.repeat(4 * 1024 * 1024 + 1), 'Ativo']])),
    ).rejects.toThrow(/limite/i);
  });
  it('preserves long unbroken identifiers and a compact report stays on one page', async () => {
    const identifier = 'IDENTIFICADOR_' + 'X'.repeat(1000);
    const document = inspect(await renderReportPdf(snapshot([[identifier, 'Descrição', 'Ativo']])));
    const extracted = document.pages.map((p) => p.text).join('');
    expect(extracted).toContain('IDENTIFICADOR_');
    expect(extracted.match(/X/g)).toHaveLength(1000);
    const compact = inspect(await renderReportPdf(snapshot([['Registro', 'Descrição', 'Ativo']])));
    expect(compact.pages).toHaveLength(1);
    if (process.env.WRITE_REPORT_PDF_FIXTURES === '1') {
      const directory = resolve(__dirname, '../../../tmp/pdfs');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        resolve(directory, 'report-compact.pdf'),
        await renderReportPdf(snapshot([['Registro', 'Descrição', 'Ativo']])),
      );
    }
  });
});
