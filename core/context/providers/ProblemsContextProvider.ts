import { BaseContextProvider } from "..";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../..";
import { getBasename } from "../../util";

class ProblemsContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "problems",
    displayTitle: "Problems",
    description: "Reference problems in the current file",
    type: "normal",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras
  ): Promise<ContextItem[]> {
    const ide = extras.ide;
    const problems = await ide.getProblems();

    const items = await Promise.all(
      problems.map(async (problem) => {
        const content = await ide.readFile(problem.filepath);
        const lines = content.split("\n");
        const rangeContent = lines
          .slice(
            Math.max(0, problem.range.start.line - 2),
            problem.range.end.line + 2
          )
          .join("\n");

        return {
          description: "Problems in current file",
          content: `\`\`\`${getBasename(
            problem.filepath
          )}\n${rangeContent}\n\`\`\`\n${problem.message}\n\n`,
          name: `Warning in ${getBasename(problem.filepath)}`,
        };
      })
    );

    return items;
  }
}

export default ProblemsContextProvider;
