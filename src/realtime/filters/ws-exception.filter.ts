import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  WsExceptionFilter,
} from '@nestjs/common';
import { Socket } from 'socket.io';

@Catch(HttpException)
export class WsHttpExceptionFilter implements WsExceptionFilter {
  private readonly logger = new Logger(WsHttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const response = exception.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : (response as { message?: string | string[] }).message;

    this.logger.warn(`${client.id}: ${JSON.stringify(message)}`);
    client.emit('error', { message: message ?? exception.message });
  }
}
