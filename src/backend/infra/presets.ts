export interface MetadataPreset {
  type: string;
  description: string;
}

export const METADATA_PRESETS: Record<string, MetadataPreset> = {
  pull_request_url: {
    type: "string",
    description: "The URL of the pull request created for this change",
  },
};
