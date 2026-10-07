import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@renr/contracts';
import { PrismaService } from '../database/prisma.service';

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ enum: ['ok'] })
  status = 'ok' as const;

  @ApiProperty({ enum: ['renr-api'] })
  service = 'renr-api' as const;

  @ApiProperty({ format: 'date-time' })
  timestamp: string = new Date().toISOString();
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOkResponse({
    type: HealthResponseDto,
    description: 'Process is alive; does not check dependencies.',
  })
  getHealth(): HealthResponse {
    return new HealthResponseDto();
  }

  @Get('ready')
  @ApiOkResponse({ type: HealthResponseDto, description: 'PostgreSQL accepted SELECT 1.' })
  @ApiResponse({
    status: 503,
    description: 'PostgreSQL unavailable or probe exceeded two seconds.',
  })
  async getReadiness(): Promise<HealthResponse> {
    try {
      await this.prisma.checkReadiness();
    } catch {
      throw new ServiceUnavailableException();
    }
    return new HealthResponseDto();
  }
}
