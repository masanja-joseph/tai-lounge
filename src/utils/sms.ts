
// Provider-neutral SMS service interface
export interface SmsProvider {
  sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

// NextSMS Implementation
export class NextSmsProvider implements SmsProvider {
  async sendSms(to: string, message: string) {
    const token = process.env.NEXTSMS_API_TOKEN;
    const from = process.env.NEXTSMS_SENDER_ID;

    if (!token || !from) {
      console.error("[NextSMS] Missing configuration");
      return { success: false, error: "Missing SMS configuration" };
    }

    try {
      const response = await fetch("https://messaging-service.co.tz/api/sms/v1/text/single", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          from,
          to: to.replace('+', ''), 
          text: message,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        return { success: false, error: `NextSMS API error: ${errorData}` };
      }

      const data = await response.json();
      return { success: true, messageId: data.messageId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Mock implementation for development
export class MockSmsProvider implements SmsProvider {
  async sendSms(to: string, message: string) {
    console.log(`[SMS MOCK] To: ${to}, Message: ${message}`);
    return { success: true, messageId: `mock-${Date.now()}` };
  }
}

// Factory to get configured provider
export function getSmsProvider(): SmsProvider {
  if (process.env.NODE_ENV === 'production' && process.env.NEXTSMS_ENABLED === 'true' && process.env.NEXTSMS_API_TOKEN) {
    return new NextSmsProvider();
  }
  return new MockSmsProvider();
}
