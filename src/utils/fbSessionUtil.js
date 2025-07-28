// Cleanly wrap facebook-chat-api's session handling
export function serializeFacebookSession(api) {
  try {
    return JSON.stringify(api.getAppState());
  } catch (err) {
    throw new Error("Failed to serialize Facebook session");
  }
}

export function deserializeFacebookSession(serialized) {
  try {
    return JSON.parse(serialized);
  } catch (err) {
    throw new Error("Failed to deserialize Facebook session");
  }
}
