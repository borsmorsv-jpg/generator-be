import {blocks, profiles} from "../../db/schema.js";
import { db, supabase } from "../../db/connection.js";
import archiveProcessor from "../../utils/archiveProcessor.js";
import {asc, desc, eq, ilike, count} from "drizzle-orm";
import {alias} from "drizzle-orm/pg-core";

export const getAllBlocks = async (request, reply) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      sortBy = "name",
      sortOrder = "asc",
    } = request.query;

    const offset = (page - 1) * limit;

    const createdByProfile = alias(profiles, "created_by_profile");
    const updatedByProfile = alias(profiles, "updated_by_profile");

    const query = db
        .select({
          id: blocks.id,
          name: blocks.name,
          category: blocks.category,
          isActive: blocks.isActive,
          archiveUrl: blocks.archiveUrl,
          definition: blocks.definition,
          createdAt: blocks.createdAt,
          updatedAt: blocks.updatedAt,
          createdByEmail: createdByProfile.email,
          createdByUsername: createdByProfile.username,
          updatedByEmail: updatedByProfile.email,
          updatedByUsername: updatedByProfile.username,
        })
        .from(blocks)
        .leftJoin(createdByProfile, eq(blocks.createdBy, createdByProfile.userId))
        .leftJoin(updatedByProfile, eq(blocks.updatedBy, updatedByProfile.userId))
        .where(search ? ilike(blocks.name, `%${search}%`) : undefined)
        .orderBy(
            sortOrder === "desc"
                ? desc(sortBy === "createdAt" ? blocks.createdAt : blocks.name)
                : asc(sortBy === "createdAt" ? blocks.createdAt : blocks.name)
        )
        .limit(limit)
        .offset(offset);

    const data = await query;

    const [{ count: totalCount }] = await db
        .select({ count: count() })
        .from(blocks)
        .where(search ? ilike(blocks.name, `%${search}%`) : undefined);

    const totalPages = Math.ceil(totalCount / limit);

    return reply.code(200).send({
      success: true,
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages,
        hasNext: page < totalPages,
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

export const createBlock = async (request, reply) => {
  try {
    const fileData = request.body.file;
    const isActive = request.body.isActive?.value === "true";
    const name = request.body.name?.value;
    const category = request.body.category?.value;

    if (!fileData || !name) {
      return reply.code(400).send({
        success: false,
        message: "Not all required fields passed",
      });
    }

    const archiveBuffer = fileData._buf || (await fileData.toBuffer());

    archiveProcessor.validateArchive(
      archiveBuffer,
      fileData.mimetype,
      fileData.filename
    );
    const archiveResult = await archiveProcessor.extractAndValidate(
      archiveBuffer
    );

    const archiveFilename = archiveProcessor.generateArchiveName(
      fileData.filename
    );

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(archiveFilename, archiveBuffer, {
        contentType: "application/zip",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(
        `Failed to upload block to file storage: ${uploadError.message}`
      );
    }

    const { data: urlData } = supabase.storage
      .from("uploads")
      .getPublicUrl(archiveFilename);

    const archiveUrl = urlData.publicUrl;

    const definitionContent = archiveResult.files["definition.json"].content;
    const templateDefinition = JSON.parse(definitionContent);

    const blockDefinition = {
      originalArchive: fileData.filename,
      mimeType: fileData.mimetype,
      archiveSize: archiveBuffer.length,
      template: {
        name: name,
        description: templateDefinition.description || "",
      },
      files: {
        template: {
          size: archiveResult.files["template.html"].size,
          lines:
            archiveResult.files["template.html"].content.split("\n").length,
        },
        styles: {
          size: archiveResult.files["styles.css"].size,
          lines: archiveResult.files["styles.css"].content.split("\n").length,
        },
        script: {
          size: archiveResult.files["main.js"].size,
          lines: archiveResult.files["main.js"].content.split("\n").length,
        },
      },
      validation: {
        isValid: archiveResult.isValid,
        requiredFiles: archiveProcessor.requiredFiles,
        totalFiles: archiveResult.fileCount,
        validatedAt: new Date().toISOString(),
      },
    };

    const [newBlock] = await db
      .insert(blocks)
      .values({
        name,
        isActive,
        category,
        archiveUrl,
        definition: blockDefinition,
        createdBy: "5d9be6fa-8b9c-4095-9568-07b2a5489b12"
      })
      .returning();

    reply.send({
      success: true,
      data: newBlock,
    });
  } catch (error) {
    reply.code(400).send({
      success: false,
      error: error.message,
    });
  }
};

export const deleteBlock = async (request, reply) => {
  try {
    const { id } = request.params;

    if (!id) {
      return reply.code(400).send({
        success: false,
        error: "Block ID is required",
      });
    }

    const [block] = await db
        .select()
        .from(blocks)
        .where(eq(blocks.id, parseInt(id)));

    if (!block) {
      return reply.code(404).send({
        success: false,
        error: "Block not found",
      });
    }

    const [deletedBlock] = await db
        .delete(blocks)
        .where(eq(blocks.id, parseInt(id)))
        .returning();

    try {
      if (block.archiveUrl) {
        const urlParts = block.archiveUrl.split('/');
        const filename = urlParts[urlParts.length - 1];

        if (filename) {
          const { error: storageError } = await supabase.storage
              .from("uploads")
              .remove([filename]);

          if (storageError) {
            console.warn(`Failed to delete file from storage: ${storageError.message}`);
          }
        }
      }
    } catch (storageError) {
      console.warn('Error during storage cleanup:', storageError);
    }

    return reply.code(200).send({
      success: true,
      data: deletedBlock,
      message: "Block deleted successfully",
    });
  } catch (error) {
    return reply.code(400).send({
      success: false,
      error: error.message,
    });
  }
};
