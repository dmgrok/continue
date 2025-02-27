import { JSONContent } from "@tiptap/react";
import {
  ContextItemWithId,
  EmbeddingsProvider,
  IContextProvider,
  ILLM,
  MessageContent,
  MessagePart,
  RangeInFile,
} from "core";
import { ExtensionIde } from "core/ide";
import { ideRequest } from "core/ide/messaging";
import { stripImages } from "core/llm/countTokens";
import { getBasename } from "core/util";

interface MentionAttrs {
  label: string;
  id: string;
  itemType?: string;
  query?: string;
}

/**
 * This function converts the input from the editor to a string, resolving any context items
 * Context items are appended to the top of the prompt and then referenced within the input
 * @param editor
 * @returns string representation of the input
 */

async function resolveEditorContent(
  editorState: JSONContent,
  contextProviders: IContextProvider[],
  llm: ILLM,
  embeddingsProvider?: EmbeddingsProvider
): Promise<[ContextItemWithId[], MessageContent]> {
  let parts: MessagePart[] = [];
  let contextItemAttrs: MentionAttrs[] = [];
  const selectedCode: RangeInFile[] = [];
  let slashCommand = undefined;
  for (const p of editorState?.content) {
    if (p.type === "paragraph") {
      const [text, ctxItems, foundSlashCommand] = resolveParagraph(p);
      if (foundSlashCommand && typeof slashCommand === "undefined") {
        slashCommand = foundSlashCommand;
      }
      if (text === "") {
        continue;
      }

      if (parts[parts.length - 1]?.type === "text") {
        parts[parts.length - 1].text += "\n" + text;
      } else {
        parts.push({ type: "text", text });
      }
      contextItemAttrs.push(...ctxItems);
    } else if (p.type === "codeBlock") {
      if (!p.attrs.item.editing) {
        const text =
          "```" + p.attrs.item.name + "\n" + p.attrs.item.content + "\n```";
        if (parts[parts.length - 1]?.type === "text") {
          parts[parts.length - 1].text += "\n" + text;
        } else {
          parts.push({
            type: "text",
            text,
          });
        }
      }

      const name: string = p.attrs.item.name;
      let lines = name.substring(name.lastIndexOf("(") + 1);
      lines = lines.substring(0, lines.lastIndexOf(")"));
      const [start, end] = lines.split("-");

      selectedCode.push({
        filepath: p.attrs.item.description,
        range: {
          start: { line: parseInt(start) - 1, character: 0 },
          end: { line: parseInt(end) - 1, character: 0 },
        },
      });
    } else if (p.type === "image") {
      parts.push({
        type: "imageUrl",
        imageUrl: {
          url: p.attrs.src,
        },
      });
    } else {
      console.warn("Unexpected content type", p.type);
    }
  }

  let contextItemsText = "";
  let contextItems: ContextItemWithId[] = [];
  const ide = new ExtensionIde();
  for (const item of contextItemAttrs) {
    if (item.itemType === "file") {
      // This is a quick way to resolve @file references
      const basename = getBasename(item.id);
      const content = await ide.readFile(item.id);
      contextItemsText += `\`\`\`title="${basename}"\n${content}\n\`\`\`\n`;
      contextItems.push({
        name: basename,
        description: item.id,
        content,
        id: {
          providerTitle: "file",
          itemId: item.id,
        },
      });
    } else {
      const data = {
        name: item.itemType === "contextProvider" ? item.id : item.itemType,
        query: item.query,
        fullInput: stripImages(parts),
        selectedCode,
      };
      const { items: resolvedItems } = await ideRequest(
        "getContextItems",
        data
      );
      contextItems.push(...resolvedItems);
      for (const resolvedItem of resolvedItems) {
        contextItemsText += resolvedItem.content + "\n\n";
      }
    }
  }

  if (contextItemsText !== "") {
    contextItemsText += "\n";
  }

  if (slashCommand) {
    let lastTextIndex = findLastIndex(parts, (part) => part.type === "text");
    parts[lastTextIndex].text = `${slashCommand} ${parts[lastTextIndex].text}`;
  }

  return [contextItems, parts];
}

function findLastIndex<T>(
  array: T[],
  predicate: (value: T, index: number, obj: T[]) => boolean
): number {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i], i, array)) {
      return i;
    }
  }
  return -1; // if no element satisfies the predicate
}

function resolveParagraph(p: JSONContent): [string, MentionAttrs[], string] {
  let text = "";
  const contextItems = [];
  let slashCommand = undefined;
  for (const child of p.content || []) {
    if (child.type === "text") {
      text += child.text;
    } else if (child.type === "mention") {
      if (!["codebase"].includes(child.attrs.id)) {
        text += child.attrs.label;
      }
      contextItems.push(child.attrs);
    } else if (child.type === "slashcommand") {
      if (typeof slashCommand === "undefined") {
        slashCommand = child.attrs.id;
      } else {
        text += child.attrs.label;
      }
    } else {
      console.warn("Unexpected child type", child.type);
    }
  }
  return [text, contextItems, slashCommand];
}

export default resolveEditorContent;
