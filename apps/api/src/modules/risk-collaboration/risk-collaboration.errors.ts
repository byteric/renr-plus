import { ForbiddenException } from '@nestjs/common';

export class CollaborationWritesDisabledException extends ForbiddenException {
  constructor() {
    super('Technical collaboration writes are disabled in this environment');
  }
}
