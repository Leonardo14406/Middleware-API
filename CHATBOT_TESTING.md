# Chatbot Testing Interface

A comprehensive web-based testing interface for your chatbot functionality before Facebook integration.

## 🚀 Quick Start

### Method 1: Using npm script (Recommended)
```bash
npm run start-testing
```

### Method 2: Using the launcher script
```bash
node start-testing.js
```

### Method 3: Manual server start
```bash
node src/server.js
```

Then open your browser and navigate to: **http://localhost:5001**

## 📋 Features

### 🔌 WebSocket Testing
- **Real-time Connection**: Test WebSocket connectivity with your chatbot service
- **Authentication**: Verify proper authentication flow
- **Message Streaming**: Test real-time message sending and receiving
- **Connection Status**: Visual indicators for connection state

### 🤖 Chatbot Integration Testing
- **Direct API Calls**: Test chatbot service without WebSocket layer
- **Message Flow**: Send and receive messages in real-time
- **Streaming Responses**: Support for chunked/streaming chatbot responses
- **Error Handling**: Comprehensive error reporting and logging

### 🛠️ Testing Tools
- **Quick Tests**: Pre-configured test scenarios
  - Direct API testing
  - Automated test message sequences
  - WebSocket statistics
  - Connection diagnostics
- **Custom Messages**: Send your own messages to test specific scenarios
- **Logs Panel**: Real-time logging for debugging

### 📊 Monitoring & Debugging
- **Connection Status**: Visual indicators (Connected/Connecting/Disconnected)
- **Message History**: Complete chat history with timestamps
- **Detailed Logs**: Comprehensive logging with timestamps and error levels
- **WebSocket Stats**: Real-time statistics about WebSocket connections

## 🔧 Configuration

The interface allows you to configure:

- **Chatbot ID**: Your chatbot identifier (default: `test-chatbot-123`)
- **Email**: Test email for authentication (default: `test@chatbot.com`)
- **Business ID**: Business identifier for testing (default: `test-business-123`)

## 📱 User Interface

### Layout
- **Left Sidebar**: Configuration, quick tests, and logs
- **Main Chat Area**: Message history and input field
- **Header**: Status and title information

### Visual Indicators
- 🔴 **Red Dot**: Disconnected
- 🟡 **Yellow Dot**: Connecting
- 🟢 **Green Dot**: Connected

### Message Types
- **User Messages**: Blue bubbles (right-aligned)
- **Bot Responses**: White bubbles with border (left-aligned)
- **System Messages**: Colored status messages (centered)

## 🧪 Testing Scenarios

### 1. Basic Connection Test
1. Fill in configuration fields
2. Click "Connect"
3. Verify successful authentication

### 2. Direct API Test
1. Click "Test Direct API" button
2. Verifies business registration endpoint
3. Tests chatbot service integration

### 3. WebSocket Message Flow
1. Connect to WebSocket
2. Send individual messages or use "Send Test Messages"
3. Verify real-time responses

### 4. Statistics Monitoring
1. Click "Check WS Stats" to view connection statistics
2. Monitor logs panel for detailed debugging information

## 🔍 Troubleshooting

### Common Issues

#### Connection Failed
- **Check Server**: Ensure server is running on port 5001
- **Environment Variables**: Verify `CHATBOT_API_URL` is set correctly
- **Network**: Check firewall and network connectivity

#### Authentication Failed
- **Configuration**: Verify chatbot ID and email are correct
- **Business Registration**: Ensure business is registered with matching details

#### No Bot Responses
- **Chatbot Service**: Check if external chatbot API is accessible
- **API Key**: Verify chatbot API credentials
- **Network**: Check external API connectivity

### Debug Information

The logs panel provides detailed information about:
- WebSocket connections and disconnections
- Message sending and receiving
- Authentication status
- API call results
- Error messages with timestamps

## 🔗 API Endpoints Tested

The interface tests these endpoints:

- `POST /business/register` - Business registration
- `GET /business/status/:businessId` - Business status
- `GET /api/webchat/stats` - WebSocket statistics
- `WebSocket /api/webchat/ws` - Real-time messaging

## 📝 Environment Requirements

Ensure your `.env` file includes:

```env
CHATBOT_API_URL=https://genistud.io/api/message
PORT=5001
```

## 🎯 Pre-Facebook Integration Checklist

Before integrating with Facebook, ensure:

✅ **WebSocket Connection**: Successful connection and authentication  
✅ **Message Flow**: Messages sent and responses received  
✅ **Error Handling**: Proper error messages and recovery  
✅ **API Integration**: Direct API calls working  
✅ **Streaming**: Chunked responses handled correctly  
✅ **Logging**: Comprehensive debugging information available  

## 🔧 Technical Details

### WebSocket Protocol
The interface uses standard WebSocket protocols with JSON message format:

```javascript
// Authentication
{
  type: 'authenticate',
  chatbotId: 'your-chatbot-id',
  email: 'your-email'
}

// Sending Messages
{
  type: 'message',
  content: 'Your message text',
  timestamp: '2025-07-30T10:00:00Z'
}
```

### Response Types
- `authenticated` - Authentication successful
- `bot_response` - Complete bot response
- `platform_bot_chunk` - Streaming response chunk
- `platform_bot_complete` - Streaming response completed
- `error` - Error message

## 🚀 Next Steps

After successful testing:

1. **Verify All Tests Pass**: Ensure all functionality works as expected
2. **Document Issues**: Note any problems or limitations
3. **Facebook Integration**: Proceed with Facebook Messenger integration
4. **Production Testing**: Test with real Facebook credentials in development environment
5. **Monitoring**: Set up production monitoring and logging

## 📞 Support

If you encounter issues:

1. Check the logs panel for detailed error information
2. Verify server is running and accessible
3. Confirm environment variables are set correctly
4. Test network connectivity to external services

Happy testing! 🎉
