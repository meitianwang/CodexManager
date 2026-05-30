export interface ExtractedAuth {
  accountId: string;
  accessToken: string;
  email?: string;
  planType?: string;
  teamName?: string;
  principalId?: string;
}

export interface WorkspaceMetadata {
  accountId: string;
  workspaceName?: string;
  structure?: string;
}

export interface ChatGPTOAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  apiKey?: string;
}
