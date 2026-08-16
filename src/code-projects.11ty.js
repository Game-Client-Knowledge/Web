class CodeProjectsIndex {
  data() {
    return {
      permalink: "code-projects/index.json",
      eleventyExcludeFromCollections: true
    };
  }

  render({ catalog }) {
    return JSON.stringify({
      schemaVersion: 1,
      commit: catalog.repository.commit,
      projects: catalog.codeProjects
    });
  }
}

module.exports = CodeProjectsIndex;
