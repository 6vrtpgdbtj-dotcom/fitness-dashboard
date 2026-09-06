import "server-only";
import { getSyncService } from "./production-runtime";
export function registerWatch(connectionId: string): Promise<{ channelId: string; expiration: Date }> { return getSyncService().registerWatch(connectionId); }
