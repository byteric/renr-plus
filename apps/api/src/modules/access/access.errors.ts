import { ConflictException } from '@nestjs/common';

/** One public outcome for absent, expired, revoked or consumed activation tokens. */
export class AccessInviteUnavailableException extends ConflictException {}
