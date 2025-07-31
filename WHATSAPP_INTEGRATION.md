# WhatsApp Integration Guide

This document explains how to set up and use the WhatsApp integration in your middleware API.

## 🔧 Environment Configuration

Add these environment variables to your `.env` file:

```env
# WhatsApp API Configuration
WHATSAPP_API_URL=https://gate.whapi.cloud/messages/text
WHATSAPP_BEARER_TOKEN=your_whatsapp_bearer_token_here
WHATSAPP_VERIFY_TOKEN=your_webhook_verification_token

# Business Configuration
BUSINESS_ID=your_business_id
CHATBOT_ID=your_chatbot_id

# Optional: Default country code for phone number formatting
DEFAULT_COUNTRY_CODE=1
```

## 📱 Webhook Setup

### 1. Configure Webhook URL
Set your webhook URL in your WhatsApp API provider dashboard:
```
https://yourdomain.com/whatsapp/webhook
```

### 2. Webhook Verification
The webhook verification is handled automatically. When WhatsApp sends a verification request, the API will respond with the challenge token.

## 🚀 Available Endpoints

### Webhook Endpoints

#### GET /whatsapp/webhook
**Purpose**: Webhook verification  
**Usage**: Automatic verification by WhatsApp

#### POST /whatsapp/webhook
**Purpose**: Receive incoming messages  
**Usage**: Automatic message processing by WhatsApp  
**Response**: Processes messages and sends AI responses

### Manual Endpoints

#### POST /whatsapp/test
**Purpose**: Send a test message  
**Request Body**:
```json
{
  "phoneNumber": "1234567890",
  "message": "Hello, this is a test message!"
}
```

#### POST /whatsapp/send-bulk
**Purpose**: Send messages to multiple numbers  
**Request Body**:
```json
{
  "phoneNumbers": ["1234567890", "0987654321"],
  "message": "Bulk message content"
}
```

#### POST /whatsapp/send-reminder
**Purpose**: Send appointment reminders  
**Request Body**:
```json
{
  "phoneNumber": "1234567890",
  "appointmentDetails": {
    "date": "2025-07-30",
    "time": "14:30",
    "location": "Main Office",
    "notes": "Bring ID"
  }
}
```

#### GET /whatsapp/health
**Purpose**: Check service health  
**Response**: Service status and available endpoints

## 💬 Message Flow

### Incoming Messages
1. WhatsApp sends message to webhook
2. System extracts phone number and message text
3. Message is processed by AI chatbot
4. AI response is sent back via WhatsApp
5. Conversation is broadcast to WebSocket clients for monitoring

### Message Processing
- Phone numbers are automatically formatted
- Business records are created/updated as needed
- All conversations are logged
- AI responses are generated using your configured chatbot

## 🔍 Testing Your Integration

### 1. Test Webhook Connectivity
```bash
curl -X GET "http://localhost:5001/whatsapp/health"
```

### 2. Send Test Message
```bash
curl -X POST "http://localhost:5001/whatsapp/test" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "1234567890",
    "message": "Hello from API!"
  }'
```

### 3. Test Bulk Messaging
```bash
curl -X POST "http://localhost:5001/whatsapp/send-bulk" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumbers": ["1234567890", "0987654321"],
    "message": "This is a bulk message!"
  }'
```

## 📊 Real-time Monitoring

WhatsApp conversations are broadcasted to WebSocket clients in real-time:

```javascript
// WebSocket message format
{
  type: 'whatsapp_message_processed',
  data: {
    platform: 'whatsapp',
    phoneNumber: '1234567890',
    userMessage: 'Hello',
    botResponse: 'Hi there! How can I help you?',
    timestamp: '2025-07-30T12:00:00Z'
  }
}
```

## 🛠️ Phone Number Formatting

The system automatically formats phone numbers:
- Removes non-digit characters
- Adds default country code (1) if missing
- Handles various international formats

Examples:
- `+1-234-567-8900` → `12345678900`
- `(234) 567-8900` → `12345678900`
- `234-567-8900` → `12345678900`

## 🔐 Security Considerations

1. **Webhook Verification**: Always verify webhook tokens
2. **Rate Limiting**: Implement rate limiting for bulk operations
3. **Data Privacy**: Handle phone numbers and messages securely
4. **Error Handling**: Graceful error handling prevents service disruption

## 📝 Error Handling

The service includes comprehensive error handling:
- Invalid message formats are rejected
- Failed AI processing continues with next message
- Network errors are logged and retried
- Webhook failures don't crash the service

## 🚨 Troubleshooting

### Common Issues

#### 1. Messages Not Being Received
- Check webhook URL configuration
- Verify WHATSAPP_VERIFY_TOKEN is correct
- Ensure server is accessible from internet

#### 2. AI Responses Not Working
- Verify CHATBOT_ID is configured
- Check CHATBOT_API_URL is accessible
- Review logs for API errors

#### 3. Messages Not Being Sent
- Verify WHATSAPP_BEARER_TOKEN is valid
- Check WHATSAPP_API_URL is correct
- Ensure sufficient API credits/quota

### Debug Information

Enable debug logging by setting:
```env
LOG_LEVEL=debug
```

Check logs for detailed information:
```bash
tail -f combined.log | grep "WhatsApp"
```

## 📈 Scaling Considerations

For high-volume deployments:

1. **Database Connection Pooling**: Configure Prisma connection limits
2. **Redis Caching**: Implement caching for frequent operations  
3. **Queue System**: Use message queues for bulk operations
4. **Load Balancing**: Distribute webhook processing across instances

## 🔄 Integration with Other Services

The WhatsApp service integrates with:
- **Chatbot Service**: For AI responses
- **WebSocket Service**: For real-time monitoring
- **Database**: For conversation logging
- **Business Management**: For customer records

## 📞 Support

For support with WhatsApp integration:
1. Check this documentation
2. Review service logs
3. Test with the health endpoint
4. Verify environment configuration
5. Check WhatsApp API provider status

## 🎯 Next Steps

After setting up WhatsApp integration:
1. Test with real WhatsApp numbers
2. Configure chatbot responses
3. Set up monitoring and alerts
4. Implement customer service workflows
5. Add analytics and reporting
