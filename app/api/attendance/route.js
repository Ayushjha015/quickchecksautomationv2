import { NextResponse } from 'next/server';
import { runAttendanceAutomation } from '@/lib/attendance';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await runAttendanceAutomation((message) => {
          sendEvent({ type: 'progress', message });
        });
        
        sendEvent({ type: 'success', result });
      } catch (error) {
        sendEvent({ type: 'error', detail: error.message || 'Unknown error' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
