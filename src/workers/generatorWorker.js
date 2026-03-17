import { workerData } from "worker_threads"
import { generateNginxConfig, generateRobotsTxt, generateSite, generateSitemapXml } from "../utils/generator.js";
import { db, supabase } from "../db/connection.js";
import slugify from "slugify";
import AdmZip from "adm-zip";
import Decimal from "decimal.js";
import { sites } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { GENERATION_STATUS, PRICE_FOR_PROMPTS_OPENAI } from "../config/constants.js";
import { buildSitePages, expandedDefinition, fillAnchors, fillBrandName, getBlockByType, prepareBlock, prepareGlobalBlocks, transformToStructuredBlocks } from "../utils/blocks.js";
import { filteredZip, replaceSiteZipWithNew } from "../utils/archiveProcessor.js";

const { process } = workerData;

function cutNumber(number, amountAfterDot) {
    const safeNumber = number ?? 0;
    const safePrecision = amountAfterDot ?? 0;
    return new Decimal(safeNumber).toDecimalPlaces(safePrecision, Decimal.ROUND_DOWN).toNumber();
}

switch(process) {
    case "create": {
        const { siteId, name, template, prompt, country, language, domain} = workerData;

        const currentTokens = {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalFalCost: 0,
        };
        const zip = new AdmZip();

        const { tokens, sitePages, siteConfigDetailed } = await generateSite({
            currentTokens,
            template,
            prompt,
            country,
            language,
            zip,
        });

        const { siteMapBody, hasError: sitemapError } = generateSitemapXml(sitePages, domain);
        const nginxConfig = generateNginxConfig({ serverName: domain });
        const robotsTxt = generateRobotsTxt(domain);

        sitePages.forEach((page) => {
            zip.addFile(page.filename, Buffer.from(page.html, 'utf8'));
        });

        if (!sitemapError) {
            zip.addFile('sitemap.xml', Buffer.from(siteMapBody, 'utf8'));
        }

        if (nginxConfig) {
            zip.addFile('nginx.conf', Buffer.from(nginxConfig, 'utf8'));
        }

        if (robotsTxt) {
            zip.addFile('robots.txt', Buffer.from(robotsTxt, 'utf8'));
        }

        const zipBuffer = zip.toBuffer();
        const safeName = slugify(`site-${name}-${new Date().getTime()}.zip`, {
            lower: true,
            strict: true,
        });
        const { error: uploadError } = await supabase.storage
            .from('sites')
            .upload(safeName, zipBuffer, {
                contentType: 'application/zip',
                upsert: false,
            });

        if (uploadError) {
            throw uploadError;
        }

        const { data: urlData } = supabase.storage.from('sites').getPublicUrl(safeName);

        await db
            .update(sites)
            .set({
                archiveUrl: urlData.publicUrl,
                totalFalPrice: tokens.totalFalCost,
                totalTokens: tokens.totalTokens,
                completionTokens: tokens.totalCompletionTokens,
                promptTokens: tokens.totalPromptTokens,
                siteConfigDetailed: siteConfigDetailed,
                inputUsdPrice: cutNumber(tokens.openAiInputPrice, 6),
                outputUsdPrice: cutNumber(tokens.openAiOutputPrice, 6),
                totalUsdPrice: cutNumber(tokens.openAiTotalPrice, 6),
                status: GENERATION_STATUS.success
            }).where(eq(sites.id, siteId));
        break;
    }
    case "regenerateSite": {
        const { siteId, template, prompt, site} = workerData;

        const zip = new AdmZip();
        const currentTokens = {
            totalPromptTokens: site.promptTokens,
            totalCompletionTokens: site.completionTokens,
            totalTokens: site.totalTokens,
            totalFalCost: site.totalFalPrice,
        };

        const { tokens, sitePages, siteConfigDetailed } = await generateSite({
            currentTokens,
            template,
            prompt,
            country: site.country,
            language: site.language,
            zip,
        });

        const { siteMapBody, hasError: sitemapError } = generateSitemapXml(sitePages, site.domain);
        const nginxConfig = generateNginxConfig({ serverName: site.domain });

        sitePages.forEach((page) => {
            zip.addFile(page.filename, Buffer.from(page.html, 'utf8'));
        });

        if (!sitemapError) {
            zip.addFile('sitemap.xml', Buffer.from(siteMapBody, 'utf8'));
        }

        const urlData = await replaceSiteZipWithNew(
            sitePages,
            site.name,
            site.archiveUrl,
            zip,
            siteMapBody,
            sitemapError,
            nginxConfig,
        );

        await db
            .update(sites)
            .set({
                archiveUrl: urlData.publicUrl,
                prompt: prompt,
                totalTokens: tokens.totalTokens,
                completionTokens: tokens.totalCompletionTokens,
                siteConfigDetailed: siteConfigDetailed,
                promptTokens: tokens.totalPromptTokens,
                totalFalPrice: tokens.totalFalCost,
                inputUsdPrice: cutNumber(tokens.openAiInputPrice, 6),
                outputUsdPrice: cutNumber(tokens.openAiOutputPrice, 6),
                totalUsdPrice: cutNumber(tokens.openAiTotalPrice, 6),
                updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
                status: GENERATION_STATUS.success,
                errorReason: null
            })
            .where(eq(sites.id, siteId));
        break;
    }
    case "regenerateBlock": {
        const { siteId, blockType, prompt, site, generationBlockId, isBlockGlobal, pageName} = workerData;

        const block = await getBlockByType(blockType);

        const tokensInfo = {
            totalPromptTokens: site.promptTokens,
            totalCompletionTokens: site.completionTokens,
            totalTokens: site.totalTokens,
            totalFalCost: site.totalFalPrice,
        };

        let generatedBlock;

        const regeneratingPage = site.siteConfigDetailed?.pages.find(
            (page) => page.filename === pageName,
        );
        const currentSiteZip = await filteredZip(
            site.archiveUrl,
            regeneratingPage,
            generationBlockId,
        );

        if (isBlockGlobal) {
            const [preparedBlock] = await prepareGlobalBlocks(
                [block],
                site.siteConfigDetailed?.pages,
                site.prompt || prompt,
                site.country,
                site.language,
                currentSiteZip,
            );
            const blockWithBrandName = fillBrandName(preparedBlock, site.siteConfigDetailed.brandName)
            tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
            tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
            tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;
            tokensInfo.totalFalCost += preparedBlock.tokens.totalFalCost;
            generatedBlock = blockWithBrandName;
        } else {
            const {
                newVariables: newVars,
                usedKeys,
                contents,
            } = await expandedDefinition(block.definition);
            const expandedBlock = { ...block, definition: { variables: newVars } };
            const preparedBlock = await prepareBlock(
                expandedBlock,
                site.prompt || prompt,
                site.country,
                site.language,
                null,
                currentSiteZip,
            );
            const blockWithBrandName = fillBrandName(preparedBlock, site.siteConfigDetailed.brandName)
            tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
            tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
            tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;
            tokensInfo.totalFalCost += preparedBlock.tokens.totalFalCost;

            generatedBlock = { ...blockWithBrandName, additionalInfo: { usedKeys, contents } };
        }

        const updatedPages = site.siteConfigDetailed?.pages?.map((page, index) => {
            const shouldUpdatePage = isBlockGlobal || page.filename === pageName;

            if (!shouldUpdatePage) {
                return page;
            }

            return {
                ...page,
                seo: site.siteConfigDetailed.seoPages[index],
                blocks: page.blocks.map((block, blockIndex) => {
                    const generationBlockMatch = block.generationBlockId === generationBlockId;
                    const globalTypeMatch =
                        isBlockGlobal && block.blockType === generatedBlock.category;
                    if (generationBlockMatch || globalTypeMatch) {
                        return {
                            id: generatedBlock.id,
                            isGlobal: isBlockGlobal,
                            blockType: generatedBlock.category,
                            category: generatedBlock.category,
                            blockIndex: blockIndex,
                            generationBlockId: `${generatedBlock.category}-${blockIndex}`,
                            definition: generatedBlock.definition,
                            variables: generatedBlock.variables,
                            hasError: false,
                            css: generatedBlock.css,
                            html: generatedBlock.html,
                            additionalInfo: generatedBlock.additionalInfo,
                        };
                    }

                    return {
                        ...block,
                        id: block.blockId,
                        category: block.blockType,
                        additionalInfo: {
                            usedKeys: [],
                            contents: [],
                        },
                    };
                }),
            };
        });

        const updatedPagesWithAnchor = fillAnchors(updatedPages, isBlockGlobal ? '' : pageName);
        const blocksCollection = transformToStructuredBlocks(updatedPagesWithAnchor);

        const sitePages = buildSitePages(
            blocksCollection,
            site.siteConfigDetailed.generatedTheme,
            site.language,
            site.country,
        );

        const { siteMapBody, hasError: sitemapError } = generateSitemapXml(sitePages, site.domain);

        const nginxConfig = generateNginxConfig({ serverName: site.domain });

        const robotsTxt = generateRobotsTxt(site.domain);

        const urlData = await replaceSiteZipWithNew(
            sitePages,
            site.name,
            site.archiveUrl,
            currentSiteZip,
            siteMapBody,
            sitemapError,
            nginxConfig,
            robotsTxt
        );

        const siteConfigDetailed = {
            brandName: site.siteConfigDetailed.brandName,
            pages: sitePages?.map((page) => ({
                title: page.title,
                path: page.path,
                filename: page.filename,
                blocks: page.blocks,
            })),
            generatedTheme: site.siteConfigDetailed.generatedTheme,
            seoPages: site.siteConfigDetailed.seoPages,
        };
        const inputPrice =
            tokensInfo.totalPromptTokens * (PRICE_FOR_PROMPTS_OPENAI.input / 1000000);
        const outputPrice =
            tokensInfo.totalCompletionTokens * (PRICE_FOR_PROMPTS_OPENAI.output / 1000000);
        const totalPrice = inputPrice + outputPrice;
        await db
            .update(sites)
            .set({
                archiveUrl: urlData.publicUrl,
                totalTokens: tokensInfo.totalTokens,
                completionTokens: tokensInfo.totalCompletionTokens,
                promptTokens: tokensInfo.totalPromptTokens,
                totalFalPrice: tokensInfo.totalFalCost,
                inputUsdPrice: cutNumber(inputPrice, 6),
                outputUsdPrice: cutNumber(outputPrice, 6),
                totalUsdPrice: cutNumber(totalPrice, 6),
                updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
                siteConfigDetailed,
                status: GENERATION_STATUS.success
            })
            .where(eq(sites.id, siteId))
        break;
    }
    default:
        console.warn("Unknown operation")
}