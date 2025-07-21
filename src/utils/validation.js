import Joi from "joi";

export const facebookQuerySchema = Joi.object({
  "hub.mode": Joi.string().valid('subscribe').required().messages({
    'any.required': 'hub.mode is required',
    'any.only': 'hub.mode must be "subscribe"'
  }),
  "hub.verify_token": Joi.string().required().messages({'any.required': 'hub.verify_token is required'}),
  "hub.challenge": Joi.string().required().messages({'any.required': 'hub.challenge is required'})
}).unknown(false);

export const facebookBodySchema = Joi.object({
  object: Joi.string().valid("page").required(),
  entry: Joi.array()
    .items(
      Joi.object({
        messaging: Joi.array()
          .items(
            Joi.object({
              sender: Joi.object({
                id: Joi.string().required()
              }).unknown(true),
              recipient: Joi.object({
                id: Joi.string().required()
              }).unknown(true),
              timestamp: Joi.number().integer().required(),
              message: Joi.object({
                mid: Joi.string().required(),
                text: Joi.string().optional(),
                quick_reply: Joi.object({
                  payload: Joi.string().required(),
                  title: Joi.string().optional()
                }).unknown(true).optional()
              }).unknown(true).optional(),
              postback: Joi.object({
                payload: Joi.string().required(),
                title: Joi.string().optional()
              }).unknown(true).optional(),
              delivery: Joi.object().unknown(true).optional(),
              read: Joi.object().unknown(true).optional()
            }).unknown(true)
          )
          .min(1)
          .required()
      }).unknown(true)
    )
    .min(1)
    .required()
}).unknown(false);

export const instagramBodySchema = Joi.object({
  object: Joi.string().valid("instagram").required(),
  entry: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      time: Joi.number().required(),
      messaging: Joi.array().items(
        Joi.object({
          sender: Joi.object({ id: Joi.string().required() }).required(),
          recipient: Joi.object({ id: Joi.string().required() }).required(),
          timestamp: Joi.number().required(),
          message: Joi.object().optional()
        })
      ).required()
    })
  ).required()
});

export const whatsappBodySchema = Joi.object({
  object: Joi.string().valid("whatsapp_business_account").required(),
  entry: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      changes: Joi.array().items(
        Joi.object({
          value: Joi.object({
            messaging_product: Joi.string().valid("whatsapp").required(),
            metadata: Joi.object().required(),
            contacts: Joi.array().optional(),
            messages: Joi.array().optional()
          }).required(),
          field: Joi.string().required()
        })
      ).required()
    })
  ).required()
});

export const instagramQuerySchema = Joi.object({
  "hub.mode": Joi.string().valid('subscribe').required().messages({
    'any.required': 'hub.mode is required',
    'any.only': 'hub.mode must be "subscribe"'
  }),
  "hub.verify_token": Joi.string().required().messages({'any.required': 'hub.verify_token is required'}),
  "hub.challenge": Joi.string().required().messages({'any.required': 'hub.challenge is required'})
}).unknown(false);

export const whatsappQuerySchema = Joi.object({
  "hub.mode": Joi.string().valid('subscribe').required().messages({
    'any.required': 'hub.mode is required',
    'any.only': 'hub.mode must be "subscribe"'
  }),
  "hub.verify_token": Joi.string().required().messages({'any.required': 'hub.verify_token is required'}),
  "hub.challenge": Joi.string().required().messages({'any.required': 'hub.challenge is required'})
}).unknown(false);
