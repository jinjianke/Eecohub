import {
  allocateAvailableSite,
  bindCreatedSiteToCard,
  getCardById,
  type CardRecord,
} from "@/lib/cards";
import {
  createRetieheSite,
  generateRetieheSiteName,
  isRetieheDomainConflict,
  type RetieheSite,
} from "@/lib/retiehe-api";

type SiteCreationDependencies = {
  createSite?: (apiKey: string, siteName: string) => Promise<RetieheSite>;
  generateName?: () => string;
};

export async function ensureSiteForCard(
  cardId: string,
  apiKey: string,
  dependencies: SiteCreationDependencies = {},
): Promise<CardRecord> {
  const card = getCardById(cardId);
  if (!card) throw new Error("卡密不存在。");
  if (card.siteName && card.publicUrl) return card;

  const allocated = allocateAvailableSite(cardId);
  if (allocated) return allocated;

  const createSite = dependencies.createSite ?? createRetieheSite;
  const generateName = dependencies.generateName ?? generateRetieheSiteName;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const siteName = generateName();
    try {
      const remoteSite = await createSite(apiKey, siteName);
      return bindCreatedSiteToCard(cardId, remoteSite.siteName, remoteSite.publicUrl);
    } catch (error) {
      if (isRetieheDomainConflict(error)) continue;
      throw error;
    }
  }

  throw new Error("多次尝试创建网站均失败，请稍后重试。");
}
