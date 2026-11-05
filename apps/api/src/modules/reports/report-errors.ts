import { HttpException } from '@nestjs/common';
export class ReportScopeTooLargeException extends HttpException {
  constructor() {
    super('Escolha um recorte menor para este relatório.', 422);
  }
}
export class ReportGenerationBusyException extends HttpException {
  constructor() {
    super('Um relatório já está em geração. Tente novamente.', 429);
  }
}
export class ReportGenerationDeadlineException extends HttpException {
  constructor() {
    super('O relatório excedeu o tempo permitido. Escolha um recorte menor.', 503);
  }
}
