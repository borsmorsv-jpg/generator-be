import OpenAI from "openai";
import {db, supabase} from "../../db/connection.js";
import {blocks, templates, sites, profiles} from "../../db/schema.js";
import {and, asc, count, desc, eq, gte, ilike, lte, sql} from "drizzle-orm";
import AdmZip from "adm-zip";
import * as fal from "@fal-ai/serverless-client";
import { alias } from "drizzle-orm/pg-core";

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

fal.config({
  credentials: process.env.FAL_KEY,
});

async function generateImageWithFal(prompt) {
  try {
    const result = await fal.subscribe("fal-ai/flux/schnell", {
      input: {
        prompt: prompt,
        image_size: "landscape_16_9",
        num_inference_steps: 4,
        num_images: 1,
      },
    });

    console.log("Image result", result);

    return result.images[0].url;
  } catch (error) {
    console.error('Fal.ai error:', error);
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=600`;
  }
}

async function downloadAndUnzipBlock(archiveUrl) {
  const response = await fetch(archiveUrl);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries();

  const blockData = {};

  zipEntries.forEach(entry => {
    const content = entry.getData().toString('utf8');

    if (entry.entryName === 'definition.json') {
      blockData.definition = JSON.parse(content);
    } else if (entry.entryName === 'template.html') {
      blockData.html = content;
    } else if (entry.entryName === 'styles.css') {
      blockData.css = content;
    }
  });

  return blockData;
}

async function generateAIContent(prompt, variables, blockCategory) {
  const variablesDescription = variables.map(v =>
      `- ${v.name} (type: ${v.type}, required: ${v.required})`
  ).join('\n');

  const systemPrompt = `You are a content generator for website blocks. Generate realistic, professional content based on the user's request.

Block type: ${blockCategory}
Variables to fill:
${variablesDescription}

Return ONLY a valid JSON object. Follow these rules for each variable type:

1. For "text" type:
   {"variableName": {"value": "your text content here"}}

2. For "image" type:
   {"variableName": {"value": null, "src": "descriptive image name", "alt": "alternative text"}}

3. For "link" type:
   {"variableName": {"value": null, "href": "url or #anchor", "label": "link text"}}

Example response:
{
  "title": {"value": "Transform Your Business Today"},
  "logo": {"value": null, "src": "modern tech company logo", "alt": "Company Logo"},
  "navItem1": {"value": null, "href": "#about", "label": "About Us"},
  "navItem2": {"value": null, "href": "#services", "label": "Services"},
  "heroText": {"value": "We help businesses grow with innovative solutions"}
}

Important: 
- Generate content appropriate for ${blockCategory} blocks
- Make links meaningful and contextual
- Keep text concise and professional`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt || "Create professional website content" }
    ],
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON");
  }

  const result = JSON.parse(jsonMatch[0]);

  for (const varName of Object.keys(result)) {
    const variable = variables.find(v => v.name === varName);
    if (variable?.type === 'image') {
      const description = result[varName].src || `${blockCategory} ${varName}`;
      console.log(`Generating image for ${varName}: ${description}`);
      result[varName].src = await generateImageWithFal(description);
    }
  }

  return result;
}

function fillVariables(html, aiContent) {
  let filledHtml = html;

  Object.keys(aiContent).forEach(varName => {
    const varData = aiContent[varName];

    Object.keys(varData).forEach(prop => {
      if (varData[prop] !== null) {
        const placeholder = `\${variables.${varName}.${prop}}`;
        filledHtml = filledHtml.replaceAll(placeholder, varData[prop]);
      }
    });
  });

  return filledHtml;
}

export const createSite = async (request, reply) => {
  try {
    const { prompt, templatesIds, isActive, name, trafficSource, country, language } = request.body;

    const template = await db.query.templates.findFirst({
      where: eq(templates.id, templatesIds[0]),
    });

    if (!template || !template.definition?.blocks) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    let allStyles = '';
    let allHtml = '';

    for (const blockDef of template.definition.blocks) {
      const blocksOfType = await db
          .select()
          .from(blocks)
          .where(eq(blocks.category, blockDef.type));

      if (blocksOfType.length > 0) {
        const randomBlock = blocksOfType[Math.floor(Math.random() * blocksOfType.length)];
        const blockData = await downloadAndUnzipBlock(randomBlock.archiveUrl);

        const aiContent = await generateAIContent(
            prompt,
            blockData.definition.variables,
            blockDef.type
        );

        console.log('AI Content:', JSON.stringify(aiContent, null, 2));

        const filledHtml = fillVariables(blockData.html, aiContent);

        allHtml += filledHtml + '\n';
        allStyles += blockData.css + '\n';
      }
    }

    const generatedSite = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Site</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    ${allStyles}
  </style>
</head>
<body>
${allHtml}
</body>
</html>`;

    const zip = new AdmZip()
    zip.addFile('index.html', Buffer.from(generatedSite, 'utf8'))

    const zipBuffer = zip.toBuffer();
    const fileName = `site-${name}-${new Date().getTime()}.zip`
    const { data, error } = await supabase.storage
        .from('sites')
        .upload(fileName, zipBuffer, {
          contentType: 'application/zip',
          upsert: false
        })

    if (error) {
      throw error
    }

    const { data: urlData } = supabase.storage
        .from('sites')
        .getPublicUrl(fileName)

    const [siteData] = await db.insert(sites).values({
      name: name,
      isActive: isActive,
      trafficSource: trafficSource,
      archiveUrl: urlData.publicUrl,
      country: country,
      language: language,
      definition: template.id,
      prompt: prompt,
      createdBy: "67366103-2833-41a8-aea2-10d589a0705c",
      updatedBy: "67366103-2833-41a8-aea2-10d589a0705c",
    }).returning();


    return reply.status(201).send({
      data: siteData,
      preview: generatedSite,
      success: true,
    });

  } catch (error) {
    return reply.status(500).send({ error: error.message });
  }
};



export const getAllSites = async (request, reply) => {
  try {
    const {
      page = 1,
      limit = 20,
      searchByName = "",
      searchById = "",
      sortBy = "createdAt",
      sortOrder = "desc",
      isActive,
      createdBy,
      updatedBy,
      createdAtFrom,
      createdAtTo,
      updatedAtFrom,
      updatedAtTo,
      createdByUserId,
      updatedByUserId,
    } = request.query;

    const parseDateFilter = (dateString) => {
      if (!dateString) return null;
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? null : date;
    };

    const createdAtFromDate = parseDateFilter(createdAtFrom);
    const createdAtToDate = parseDateFilter(createdAtTo);
    const updatedAtFromDate = parseDateFilter(updatedAtFrom);
    const updatedAtToDate = parseDateFilter(updatedAtTo);

    const offset = (page - 1) * limit;

    const createdByProfile = alias(profiles, "created_by_profile");
    const updatedByProfile = alias(profiles, "updated_by_profile");

    const filters = [];

    if (searchByName) filters.push(ilike(blocks.name, `%${searchByName}%`));
    if (searchById) {
      filters.push(
          sql`CAST(${blocks.id} AS TEXT) ILIKE ${'%' + searchById + '%'}`
      );
    };
    if (createdBy) filters.push(eq(blocks.createdBy, createdBy));
    if (updatedBy) filters.push(eq(blocks.updatedBy, updatedBy));

    if (createdAtFromDate) filters.push(gte(blocks.createdAt, createdAtFromDate));
    if (createdAtToDate) filters.push(lte(blocks.createdAt, createdAtToDate));
    if (updatedAtFromDate) filters.push(gte(blocks.updatedAt, updatedAtFromDate));
    if (updatedAtToDate) filters.push(lte(blocks.updatedAt, updatedAtToDate));

    if (createdByUserId) filters.push(lte(blocks.createdBy, createdByUserId));
    if (updatedByUserId) filters.push(lte(blocks.updatedBy, updatedByUserId));

    if (isActive === "true") {
      filters.push(eq(blocks.isActive, true));
    } else if (isActive === "false") {
      filters.push(eq(blocks.isActive, false));
    }

    const order = (column) => sortOrder === "asc" ? asc(column) : desc(column);

    const query = db
        .select({
          id: sites.id,
          name: sites.name,
          isActive: sites.isActive,
          archiveUrl: sites.archiveUrl,
          definition: sites.definition,
          createdAt: sites.createdAt,
          updatedAt: sites.updatedAt,
          createdByEmail: createdByProfile.email,
          createdByUsername: createdByProfile.username,
          updatedByEmail: updatedByProfile.email,
          updatedByUsername: updatedByProfile.username,
        })
        .from(sites)
        .leftJoin(createdByProfile, eq(sites.createdBy, createdByProfile.userId))
        .leftJoin(updatedByProfile, eq(sites.updatedBy, updatedByProfile.userId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(order(sites[sortBy]))
        .limit(limit)
        .offset(offset);

    const data = await query;

    const [{ count: totalCount }] = await db
        .select({ count: count() })
        .from(sites)
        .where(filters.length ? and(...filters) : undefined);

    return reply.code(200).send({
      success: true,
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: page < Math.ceil(totalCount / limit),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    reply.code(400).send({
      success: false,
      error: error.message,
    });
  }
};