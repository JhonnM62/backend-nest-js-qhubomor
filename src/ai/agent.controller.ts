import { Controller, Post, Body } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private agentService: AgentService) {}

  @Post('chat')
  async chat(@Body() body: { message?: string; threadId: string; resumeCommand?: any }) {
    if (!body.threadId) {
      return { error: 'threadId is required' };
    }
    try {
      const response = await this.agentService.invokeAgent(
        body.message || '', 
        body.threadId, 
        body.resumeCommand
      );
      return { success: true, data: response };
    } catch (error) {
      console.error('Error invoking agent:', error);
      return { success: false, error: 'Internal Server Error', details: error.message };
    }
  }
}
