import { profiles, templates } from "../../db/schema.js";
import { db, supabase } from "../../db/connection.js";
import archiveProcessor from "../../utils/archiveProcessor.js";
import { asc, gte, lte, desc, eq, ilike, count, and, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export const getAllTemplates = async (request, reply) => {
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

    if (searchByName) filters.push(ilike(templates.name, `%${searchByName}%`));
    if (searchById) {
      filters.push(
          sql`CAST(${templates.id} AS TEXT) ILIKE ${'%' + searchById + '%'}`
      );
    };
    if (createdBy) filters.push(eq(templates.createdBy, createdBy));
    if (updatedBy) filters.push(eq(templates.updatedBy, updatedBy));

    if (createdAtFromDate) filters.push(gte(templates.createdAt, createdAtFromDate));
    if (createdAtToDate) filters.push(lte(templates.createdAt, createdAtToDate));
    if (updatedAtFromDate) filters.push(gte(templates.updatedAt, updatedAtFromDate));
    if (updatedAtToDate) filters.push(lte(templates.updatedAt, updatedAtToDate));

    if (isActive === "true") {
      filters.push(eq(templates.isActive, true));
    } else if (isActive === "false") {
      filters.push(eq(templates.isActive, false));
    }

    const order = (column) => sortOrder === "asc" ? asc(column) : desc(column);

    const query = db
        .select({
          id: templates.id,
          name: templates.name,
          isActive: templates.isActive,
          archiveUrl: templates.archiveUrl,
          definition: templates.definition,
          createdAt: templates.createdAt,
          updatedAt: templates.updatedAt,
          createdByEmail: createdByProfile.email,
          createdByUsername: createdByProfile.username,
          updatedByEmail: updatedByProfile.email,
          updatedByUsername: updatedByProfile.username,
        })
        .from(templates)
        .leftJoin(createdByProfile, eq(templates.createdBy, createdByProfile.userId))
        .leftJoin(updatedByProfile, eq(templates.updatedBy, updatedByProfile.userId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(order(templates[sortBy]))
        .limit(limit)
        .offset(offset);

    const data = await query;

    const [{ count: totalCount }] = await db
        .select({ count: count() })
        .from(templates)
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

export const createTemplate = async (request, reply) => {
  try {
    const fileData = request.body.file;
    const isActive = request.body.isActive?.value === "true";
    const name = request.body.name?.value;

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

    const { error: uploadError } = await supabase.storage
      .from("templates")
      .upload(archiveFilename, archiveBuffer, {
        contentType: "application/zip",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(
        `Failed to upload template to file storage: ${uploadError.message}`
      );
    }

    const { data: urlData } = supabase.storage
      .from("templates")
      .getPublicUrl(archiveFilename);

    const archiveUrl = urlData.publicUrl;

    const templateDefinition = {
      originalArchive: fileData.filename,
      mimeType: fileData.mimetype,
      archiveSize: archiveBuffer.length,
      template: {
        name: name,
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

    const [newTemplate] = await db
      .insert(templates)
      .values({
        name,
        isActive,
        archiveUrl,
        definition: templateDefinition,
        createdBy: "67366103-2833-41a8-aea2-10d589a0705c"
      })
      .returning();

    reply.send({
      success: true,
      data: newTemplate,
    });
  } catch (error) {
    reply.code(400).send({
      success: false,
      error: error.message,
    });
  }
};

export const deleteTemplate = async (request, reply) => {
  try {
    const { id } = request.params;

    if (!id) {
      return reply.code(400).send({
        success: false,
        error: "Template ID is required",
      });
    }

    const [template] = await db
        .select()
        .from(templates)
        .where(eq(templates.id, parseInt(id)));

    if (!template) {
      return reply.code(404).send({
        success: false,
        error: "Template not found",
      });
    }

    const [deletedTemplate] = await db
        .delete(templates)
        .where(eq(templates.id, parseInt(id)))
        .returning();

    try {
      if (template.archiveUrl) {
        const urlParts = template.archiveUrl.split('/');
        const filename = urlParts[urlParts.length - 1];

        if (filename) {
          const { error: storageError } = await supabase.storage
              .from("templates")
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
      data: deletedTemplate,
      message: "Template deleted successfully",
    });
  } catch (error) {
    return reply.code(400).send({
      success: false,
      error: error.message,
    });
  }
};

export const updateTemplate = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!id) {
      return reply.code(400).send({ success: false, error: "Id is required" });
    }

    const [existing] = await db
        .select()
        .from(templates)
        .where(eq(templates.id, Number(id)));

    if (!existing) {
      return reply.code(404).send({ success: false, error: "Template not found" });
    }

    const fileData = request.body.file;
    const incomingName = request.body.name?.value;
    const description = request.body.description?.value;
    const incomingCategory = request.body.category?.value;
    const incomingIsActiveRaw = request.body.isActive?.value;
    const incomingIsActive =
        incomingIsActiveRaw === undefined
            ? existing.isActive
            : incomingIsActiveRaw === "true";

    const userId = "67366103-2833-41a8-aea2-10d589a0705c";

    const updatePayload = {
      name: incomingName ?? existing.name,
      category: incomingCategory ?? existing.category,
      isActive: incomingIsActive,
      description,
      updatedBy: userId,
      updatedAt: new Date(),
    };

    // If no new file — simple update
    if (!fileData) {
      const [updatedTemplate] = await db
          .update(templates)
          .set(updatePayload)
          .where(eq(templates.id, Number(id)))
          .returning();
      return reply.code(200).send({ success: true, data: updatedTemplate });
    }

    const archiveBuffer = fileData._buf || (await fileData.toBuffer());

    archiveProcessor.validateArchive(archiveBuffer, fileData.mimetype, fileData.filename);

    const archiveResult = await archiveProcessor.extractAndValidate(archiveBuffer);

    const definitionContent = archiveResult.files["definition.json"].content;
    const templateDefinition = JSON.parse(definitionContent || "{}");

    const newDefinition = {
      originalArchive: fileData.filename,
      mimeType: fileData.mimetype,
      archiveSize: archiveBuffer.length,
      template: {
        name: updatePayload.name,
        description: templateDefinition.description || "",
      },
      files: {
        template: {
          size: archiveResult.files["template.html"].size,
          lines: archiveResult.files["template.html"].content.split("\n").length,
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

    const timestamp = Date.now();
    const safeArchiveFilename = `template_${id}_${timestamp}.zip`;

    const { error: uploadError } = await supabase.storage
        .from("templates")
        .upload(safeArchiveFilename, archiveBuffer, {
          contentType: "application/zip",
          upsert: false, // false is OK because filename contains timestamp -> unique
        });

    if (uploadError) {
      throw new Error(`Failed to upload new archive: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from("templates").getPublicUrl(safeArchiveFilename);
    const newArchiveUrl = urlData.publicUrl;

    updatePayload.archiveUrl = newArchiveUrl;
    updatePayload.definition = newDefinition;

    let updatedTemplate;
    try {
      const [res] = await db
          .update(templates)
          .set(updatePayload)
          .where(eq(templates.id, Number(id)))
          .returning();

      updatedTemplate = res;
    } catch (dbError) {
      try {
        const { error: cleanupError } = await supabase.storage.from("templates").remove([safeArchiveFilename]);
        if (cleanupError) {
          console.warn("Failed to remove newly uploaded file after DB error:", cleanupError.message);
        }
      } catch (cleanupErr) {
        console.warn("Cleanup attempt error:", cleanupErr);
      }
      throw new Error(`DB update failed: ${dbError.message}`);
    }

    try {
      if (existing.archiveUrl) {
        const oldFilename = existing.archiveUrl.split("/").pop();
        if (oldFilename && oldFilename !== safeArchiveFilename) {
          const { error: removeErr } = await supabase.storage.from("templates").remove([oldFilename]);
          if (removeErr) {
            console.warn("Failed to delete old archive from storage:", removeErr.message);
          }
        }
      }
    } catch (remErr) {
      console.warn("Error while deleting old archive:", remErr);
    }

    return reply.code(200).send({ success: true, data: updatedTemplate });
  } catch (error) {
    return reply.code(400).send({
      success: false,
      error: error.message || String(error),
    });
  }
};
