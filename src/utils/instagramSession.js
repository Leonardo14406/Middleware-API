/**
 * Deserialize cookies and apply them to an IG client instance.
 */
export async function deserializeCookies(ig, cookieData) {
    ig.state.generateDevice(cookieData?.deviceString || "default-device");
  
    await ig.state.deserializeCookieJar(cookieData);
    await ig.account.currentUser(); // Verifies session is valid
  }
  
  /**
   * Serialize cookies from an IG client instance.
   */
  export async function serializeCookies(ig) {
    const serialized = await ig.state.serializeCookieJar();
    return JSON.stringify(serialized);
  }
  