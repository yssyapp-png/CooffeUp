import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The session token goes to the device keychain (SecureStore); everything else that must survive
 * an app restart without being secret (catalogue, offline outbox, server address) goes to AsyncStorage.
 */
const TOKEN_KEY = "cooffeup.session";

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full or unavailable; the caller keeps working with memory only.
  }
}

export async function readSession<T>(): Promise<T | null> {
  try {
    const raw = Platform.OS === "web" ? await AsyncStorage.getItem(TOKEN_KEY) : await SecureStore.getItemAsync(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeSession(value: unknown | null) {
  const raw = value === null ? null : JSON.stringify(value);
  if (Platform.OS === "web") {
    if (raw === null) await AsyncStorage.removeItem(TOKEN_KEY);
    else await AsyncStorage.setItem(TOKEN_KEY, raw);
    return;
  }
  if (raw === null) await SecureStore.deleteItemAsync(TOKEN_KEY);
  else await SecureStore.setItemAsync(TOKEN_KEY, raw);
}
