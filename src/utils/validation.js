// Facebook webhook validation schemas using Joi
import Joi from "joi";

export const facebookQuerySchema = Joi.object({
  "hub.mode": Joi.string().required(),
  "hub.verify_token": Joi.string().required(),
  "hub.challenge": Joi.string().required()
});

export const facebookBodySchema = Joi.object({
  entry: Joi.array().items(
    Joi.object({
      messaging: Joi.array().items(
        Joi.object({
          sender: Joi.object({ id: Joi.string().required() }).required(),
          recipient: Joi.object({ id: Joi.string().required() }).required(),
          timestamp: Joi.number().required(),
          message: Joi.object({
            mid: Joi.string().required(),
            text: Joi.string().allow("")
          }).unknown(true),
          postback: Joi.object().optional(),
        }).unknown(true)
      ).required()
    }).unknown(true)
  ).required()
}).unknown(true);
