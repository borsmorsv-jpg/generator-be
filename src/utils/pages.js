import {openai} from "../lib/AiClients.js";

export const generatePagesWithAI = async ({ prompt, language, country, pages = [] }) => {
    const pageCount = pages.length;

    const systemMessage = {
        role: "system",
        content: `You are an SEO specialist. Generate exactly ${pageCount} page structure(s) in a JSON array.
    
CRITICAL RULES:
1. Return ONLY a JSON array of objects, no other text, no markdown, no explanations.
2. Each object must have this EXACT structure:
{
  "pagePath": "string starting with /",
  "pageTitle": "english title",
  "seo": {
    "title": "50-60 characters in ${language}",
    "description": "150-160 characters in ${language}",
    "keywords": "3-5 keywords in ${language}",
    "ogTitle": "social media title in ${language}",
    "ogDescription": "social media description in ${language}"
  }
}

GENERATION LOGIC:
${pageCount === 1
            ? `Generate SEO for single homepage. pagePath must be "/", pageTitle must be "Home".`
            : `Generate ${pageCount} different pages based on users prompt ${prompt}.
Each page must be unique and relevant to its category. 

CRITICAL PATH AND TITLE RULES:
1. pagePath must start with "/" and be SINGLE LEVEL (no slashes after the first one)
2. pagePath should be lowercase with hyphens (e.g., "/honda-service" NOT "/honda/service")
3. pageTitle must be human readable English without special characters (e.g., "Honda Service" NOT "honda/service")
4. For homepage (always first): pagePath="/", pageTitle="Home"
5. Convert spaces to hyphens in pagePath, keep spaces in pageTitle`
        }

SEO CONTENT RULES:
1. All SEO fields (title, description, keywords, ogTitle, ogDescription) must be in ${language}
2. Content must be relevant to business topic: "${prompt}"
3. Consider ${country} audience preferences
4. Character limits: title=50-60, description=150-160
5. Page titles must be in English
6. Generate realistic, engaging content

OUTPUT FORMAT CONTRACT (MANDATORY):

You MUST ALWAYS return a SINGLE JSON OBJECT with the following exact structure:

{
  "pages": [
    {
      "pagePath": "string starting with /",
      "pageTitle": "Human readable english title of the page",
      "seo": {
        "title": "50-60 characters in ${language}",
        "description": "150-160 characters in ${language}",
        "keywords": "3-5 keywords in ${language}",
        "ogTitle": "social media title in ${language}",
        "ogDescription": "social media description in ${language}"
      }
    }
  ]
}

STRICT RULES:
1. The root JSON element MUST be an OBJECT, not an array.
2. The root object MUST contain ONLY the "pages" field.
3. "pages" MUST ALWAYS be an array, even if there is only one page.
4. NEVER return a raw array as the root element.
5. NEVER include any additional fields (no metadata, no explanations).
6. NEVER wrap or change the structure in any other way.
7. Return ONLY valid JSON. No markdown, no text, no comments.

If these rules are violated, the response is considered INVALID`
    };

    const userMessage = {
        role: "user",
        content: `Generate SEO for ${pageCount} page(s). Business: "${prompt}". Language: ${language}. Country: ${country}.`
    };

    try {
        console.log("Start")
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [systemMessage, userMessage],
            temperature: 1,
        });

        const content = completion.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('AI did not return valid JSON');
        }

        const result = JSON.parse(jsonMatch[0]);

        console.log("AI Response:", result);

        const normalizePathAndTitle = (item, index) => {
            let pagePath = item.pagePath || "";
            let pageTitle = item.pageTitle || "";

            if (index === 0) {
                return {
                    pagePath: "/",
                    pageTitle: "Home",
                    seo: item.seo
                };
            }

            if (pagePath) {
                pagePath = pagePath.replace(/^\/+|\/+$/g, '');
                pagePath = pagePath.replace(/[\/\s]+/g, '-');
                pagePath = pagePath.toLowerCase();
                pagePath = pagePath.replace(/[^a-z0-9-]/g, '');
                pagePath = pagePath.replace(/-+/g, '-');
                pagePath = pagePath.replace(/^-+|-+$/g, '');
                pagePath = '/' + pagePath;
            } else {
                pagePath = '/' + (pageTitle || `page-${index}`).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            }

            if (pageTitle) {
                pageTitle = pageTitle.replace(/[\/\\]/g, ' ');
                pageTitle = pageTitle.replace(/\s+/g, ' ');
                pageTitle = pageTitle.replace(/\b\w/g, char => char.toUpperCase());
                pageTitle = pageTitle.substring(0, 50).trim();
            } else {
                pageTitle = pagePath.substring(1)
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, char => char.toUpperCase());
            }

            return {
                pagePath,
                pageTitle,
                seo: item.seo
            };
        };

        const normalizedPages = result.pages.map((item, index) => normalizePathAndTitle(item, index));

        normalizedPages.forEach(pg => console.log("Normalized page:", pg.pagePath, pg.pageTitle));

        if (pageCount === 1) {
            return {
                pages: [{
                    ...(pages[0] || {}),
                    path: "/",
                    title: "Home",
                    seo: normalizedPages[0]?.seo || createFallbackSEO(prompt, language, country, "Home")
                }],
                hasError: false,
                tokens: {
                    totalPromptTokens: completion.usage?.prompt_tokens || 0,
                    totalCompletionTokens: completion.usage?.completion_tokens || 0,
                    totalTokens: completion.usage?.total_tokens || 0,
                }
            };
        }

        const populatedPages = normalizedPages.map((item, index) => ({
            ...(pages[index] || {}),
            path: item.pagePath,
            title: item.pageTitle,
            seo: item.seo || createFallbackSEO(prompt, language, country, item.pageTitle),
        }));

        return {
            pages: populatedPages,
            hasError: false,
            tokens: {
                totalPromptTokens: completion.usage?.prompt_tokens || 0,
                totalCompletionTokens: completion.usage?.completion_tokens || 0,
                totalTokens: completion.usage?.total_tokens || 0,
            }
        };

    } catch (error) {
        console.log("error", error);
        const fallbackPages = pages.map((page, index) => {
            const isHome = index === 0;
            const title = isHome ? "Home" : (page?.title || `Page ${index + 1}`);
            const path = isHome ? "/" : `/${title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;

            return {
                ...page,
                path,
                title,
                seo: createFallbackSEO(prompt, language, country, title),
            };
        });

        return {
            pages: fallbackPages,
            hasError: true,
            tokens: {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
            }
        };
    }
};

const createFallbackSEO = (prompt, language, country, pageName) => {
    return {
        title: `${prompt.substring(0, 40)} - ${pageName}`.substring(0, 60),
        description: `${prompt.substring(0, 140)}. Serving ${country} with quality services.`.substring(0, 160),
        keywords: `${prompt}, ${pageName}, ${country}, ${language}`,
        ogTitle: `${prompt.substring(0, 40)} - ${pageName}`.substring(0, 60),
        ogDescription: `${prompt.substring(0, 140)}. Professional services in ${country}.`.substring(0, 160)
    };
};