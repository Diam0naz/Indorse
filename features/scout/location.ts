/**
 * features/scout/location.ts — GPS helper for scout captures
 *
 * Wraps expo-location so the camera overlay and any future flow share one
 * permission-then-fix path. Returns `null` instead of throwing when the user
 * declines or the device has no fix, so callers can fall back cleanly.
 */

import * as Location from 'expo-location'

export interface ScoutCoords {
  lat: number
  lng: number
  /** Horizontal accuracy in metres, when the platform reports it. */
  accuracy: number | null
}

/** Ask for foreground location access. `true` when the user grants it. */
export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    return status === 'granted'
  } catch {
    return false
  }
}

/**
 * Read the current foreground permission *without* prompting — used by the
 * setup wizard and the Profile banner to show live granted/not-allowed state.
 * A missing native module or a denied query reads as "not granted".
 */
export async function getLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync()
    return status === 'granted'
  } catch {
    return false
  }
}

/** Request permission and read one high-accuracy fix. `null` when unavailable. */
export async function getCurrentCoords(): Promise<ScoutCoords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return null

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    }
  } catch {
    return null
  }
}
