import { z } from "zod";

const assetSchema = z.object({
  type: z.enum(["player", "draft_pick", "faab", "custom"]),
  label: z.string().trim().min(1).max(120),
});
const sideSchema = z.object({
  team_id: z.uuid(),
  assets: z.array(assetSchema).min(1).max(12),
});
export const tradePayloadSchema = z.object({
  league_id: z.uuid(),
  privacy_mode: z.enum(["anonymous", "commissioner_may_reveal_after_close"]),
  participants_may_vote: z.boolean(),
  closes_at: z.iso.datetime(),
  required_veto_votes: z.number().int().min(1).max(100).optional(),
  sides: z.array(sideSchema).min(2).max(8),
  eligible_team_ids: z.array(z.uuid()).min(1).max(100),
});
export type TradePayload = z.infer<typeof tradePayloadSchema>;

export function describeAssets(labels: string[]): string {
  return labels.join(" + ");
}
