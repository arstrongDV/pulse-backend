import { Controller, Get, UseGuards } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('test')
  async testStorage() {
    const url = await this.storageService.createUploadUrl(
      'test/test.txt',
      'text/plain',
    );

    return { url };
  }
}
