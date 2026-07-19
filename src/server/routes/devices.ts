import { getDeviceInfo, listConnectedDeviceUdids } from "../services/afc.ts";
import type { DeviceInfo } from "../../shared/types.ts";

export function makeDevicesListHandler() {
  return async (_req: Request): Promise<Response> => {
    const udids = await listConnectedDeviceUdids();
    const devices: DeviceInfo[] = [];
    for (const udid of udids) {
      try {
        const info = await getDeviceInfo(udid);
        // Wi-Fi vs USB isn't distinguished by these two libimobiledevice calls
        // alone; default to "usb" (the common case) — a future refinement
        // could shell out to `idevice_id -n` and diff the two UDID lists.
        devices.push({ ...info, connectionType: "usb" });
      } catch {
        // Skip a device we can't get info for (e.g. locked/untrusted).
      }
    }
    return Response.json(devices);
  };
}
