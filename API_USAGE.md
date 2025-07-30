# Business Platform API Usage Guide

This guide explains how to use the updated Business Platform API endpoints.

## API Endpoints

### 1. Register Business
**POST** `/business/register`

Register a new business with basic information (no platform credentials).

**Request Body:**
```json
{
  "businessName": "My Business Name",
  "email": "business@example.com",
  "password": "secure_password_123",
  "chatbotId": "your-chatbot-id"
}
```

**Response:**
```json
{
  "message": "Business registered successfully",
  "business": {
    "id": "auto-generated-business-id",
    "businessName": "My Business Name",
    "email": "business@example.com",
    "chatbotId": "your-chatbot-id",
    "createdAt": "2025-07-29T10:00:00.000Z",
    "updatedAt": "2025-07-29T10:00:00.000Z"
  }
}
```

### 2. Add Platform Credentials
**POST** `/business/platforms/{businessId}`

Add credentials for all platforms (Instagram, Facebook, WhatsApp, Website) in a single request.

**Request Body:**
```json
{
  "instagramUsername": "your_instagram_username",
  "instagramPassword": "your_instagram_password",
  "facebookEmail": "your_facebook_email",
  "facebookPassword": "your_facebook_password",
  "whatsappNumber": "+1234567890",
  "whatsappApiKey": "your_whatsapp_api_key",
  "websiteUrl": "https://your-website.com",
  "websiteApiKey": "your_website_api_key"
}
```

**Response:**
```json
{
  "message": "Platform credentials processed. 4 platforms configured successfully.",
  "platforms": {
    "instagram": true,
    "facebook": true,
    "whatsapp": true,
    "website": true
  },
  "businessId": "your-unique-business-id"
}
```

### 3. Get Business Status
**GET** `/business/status/{businessId}`

Check the status of a business and which platforms are configured.

**Response:**
```json
{
  "businessId": "your-unique-business-id",
  "business": {
    "igUsername": "your_instagram_username",
    "chatbotId": "your-chatbot-id",
    "email": "business@example.com",
    "createdAt": "2025-07-29T10:00:00.000Z",
    "updatedAt": "2025-07-29T10:00:00.000Z"
  },
  "platforms": {
    "instagram": true,
    "facebook": true,
    "whatsapp": true,
    "website": false
  },
  "totalPlatforms": 3
}
```

### 4. Remove Platform Credentials
**DELETE** `/business/platforms/{businessId}`

Remove credentials for specific platforms.

**Request Body:**
```json
{
  "platforms": ["INSTAGRAM", "FACEBOOK"]
}
```

**Response:**
```json
{
  "message": "Successfully removed 2 platform credentials",
  "businessId": "your-unique-business-id",
  "removedPlatforms": ["instagram", "facebook"],
  "count": 2
}
```

### 5. Update Business Info
**PUT** `/business/business/{businessId}`

Update business information.

**Request Body:**
```json
{
  "igUsername": "new_instagram_username",
  "email": "new_email@example.com"
}
```

**Response:**
```json
{
  "message": "Business updated",
  "updated": {
    "id": "your-unique-business-id",
    "igUsername": "new_instagram_username",
    "chatbotId": "your-chatbot-id",
    "email": "new_email@example.com",
    "createdAt": "2025-07-29T10:00:00.000Z",
    "updatedAt": "2025-07-29T10:15:00.000Z"
  }
}
```

## Usage Flow

### Complete Setup Flow
1. **Register Business**: Create the business entity with basic info
2. **Add Platform Credentials**: Configure all platforms at once
3. **Check Status**: Verify all platforms are properly configured

```bash
```bash
# 1. Register business (separate from platforms)
POST /business/register
{
  "businessName": "My Business",
  "email": "contact@mybusiness.com",
  "password": "secure_password_123",
  "chatbotId": "chatbot-456"
}

# 2. Add all platform credentials in one call (use returned businessId)
POST /business/platforms/{businessId}
{
  "instagramUsername": "mybusiness_ig",
  "instagramPassword": "ig_password",
  "facebookEmail": "contact@mybusiness.com",
  "facebookPassword": "fb_password",
  "whatsappNumber": "+1234567890",
  "whatsappApiKey": "wa_api_key_123",
  "websiteUrl": "https://mybusiness.com",
  "websiteApiKey": "web_api_key_456"
}

# 3. Check status
curl -X GET http://localhost:5001/business/status/{businessId}
```
```

## Platform Status

### Currently Implemented
- **Instagram**: ✅ Full implementation with instagram-private-api
- **Facebook**: ✅ Full implementation with facebook-chat-api

### Placeholder Implementation
- **WhatsApp**: 🚧 Service structure ready, API integration pending
- **Website**: 🚧 Service structure ready, webhook integration pending

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200`: Success
- `400`: Invalid request data
- `404`: Business not found
- `500`: Server error

Example error response:
```json
{
  "error": "Missing required fields: businessId, igUsername, chatbotId, email"
}
```

## WhatsApp Integration Endpoints

### 1. WhatsApp Health Check
**GET** `/whatsapp/health`

Check if WhatsApp service is running and get available endpoints.

**Response:**
```json
{
  "success": true,
  "service": "WhatsApp Service",
  "status": "running",
  "timestamp": "2025-07-30T12:00:00.000Z",
  "endpoints": {
    "webhook": "/whatsapp/webhook",
    "bulkSend": "/whatsapp/send-bulk",
    "appointmentReminder": "/whatsapp/send-reminder",
    "test": "/whatsapp/test"
  }
}
```

### 2. Send WhatsApp Test Message
**POST** `/whatsapp/test`

Send a test message to a WhatsApp number.

**Request Body:**
```json
{
  "phoneNumber": "1234567890",
  "message": "Hello from API!"
}
```

### 3. Send Bulk WhatsApp Messages
**POST** `/whatsapp/send-bulk`

Send the same message to multiple WhatsApp numbers.

**Request Body:**
```json
{
  "phoneNumbers": ["1234567890", "0987654321"],
  "message": "This is a bulk message!"
}
```

### 4. Send Appointment Reminder
**POST** `/whatsapp/send-reminder`

Send a formatted appointment reminder via WhatsApp.

**Request Body:**
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

### 5. WhatsApp Webhook (Automatic)
**GET/POST** `/whatsapp/webhook`

- **GET**: Used by WhatsApp for webhook verification
- **POST**: Receives incoming WhatsApp messages and processes them with AI

## Notes

- All platform credentials are optional in the `addPlatformCredentials` endpoint
- You can add credentials for only the platforms you need
- WhatsApp integration is fully implemented with AI chatbot responses
- Website services are placeholder implementations ready for future development
- Platform removal supports multiple platforms in a single request
- Business registration is now separate from platform authentication for better organization
- WhatsApp messages are automatically processed and responded to via AI
- For detailed WhatsApp setup, see `WHATSAPP_INTEGRATION.md`
