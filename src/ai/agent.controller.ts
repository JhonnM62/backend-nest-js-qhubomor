import { Controller, Post, Body, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private agentService: AgentService) {}

  @Post('chat')
  @UseInterceptors(FileInterceptor('image'))
  async chat(
    @Body() body: { message?: string; threadId: string; resumeCommand?: any },
    @UploadedFile() file?: Express.Multer.File
  ) {
    if (!body.threadId) {
      return { error: 'threadId is required' };
    }
    
    // Parse resumeCommand si viene como string desde FormData
    let resumeCommandParsed = body.resumeCommand;
    if (typeof body.resumeCommand === 'string') {
      try {
        resumeCommandParsed = JSON.parse(body.resumeCommand);
      } catch (e) {
        // ignora si no es JSON válido
      }
    }

    try {
      const response = await this.agentService.invokeAgent(
        body.message || '', 
        body.threadId, 
        resumeCommandParsed,
        file
      );
      return { success: true, data: response };
    } catch (error) {
      console.error('Error invoking agent:', error);
      return { success: false, error: 'Internal Server Error', details: error.message };
    }
  }
}
