import { basename, isAbsolute } from "node:path"
import { OpenApiTanStudioGateway } from "./api"
import type { AttachmentFileInput, Attachment } from "./gateway"

export class LocalFileTanStudioGateway extends OpenApiTanStudioGateway {
  async attachLocalFile(input: AttachmentFileInput): Promise<Attachment> {
    if (!isAbsolute(input.filePath)) {
      throw new Error("filePath must be absolute")
    }
    const file = Bun.file(input.filePath)
    if (!(await file.exists())) throw new Error("Attachment file not found")
    if (file.size < 1 || file.size > 512 * 1024 * 1024) {
      throw new Error("Attachment must be between 1 byte and 512 MiB")
    }
    const attachment = await this.createAttachment({
      title: input.title ?? basename(input.filePath),
      filename: basename(input.filePath),
      mediaType: input.mediaType ?? (file.type || "application/octet-stream"),
      sourceUrl: input.sourceUrl ?? null,
      description: input.description ?? "",
      capturedAt: input.capturedAt ?? null,
      links: input.links,
    })
    return this.putAttachmentContent(attachment, file)
  }
}
