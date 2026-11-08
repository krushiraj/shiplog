import type { CachedChannel } from "@/db/schema";

// GraphQL documents verified against the live schema (docs/buffer-api.md §3).

export const ACCOUNT_QUERY = /* GraphQL */ `
  query Account {
    account {
      id email name avatar timezone
      organizations { id name channelCount limits { channels tags scheduledPosts } }
    }
  }
`;

export const CHANNELS_QUERY = /* GraphQL */ `
  query Channels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id name displayName service avatar isDisconnected isLocked isQueuePaused timezone type descriptor
    }
  }
`;

export const CREATE_POST_MUTATION = /* GraphQL */ `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { id text status dueAt channelId shareMode } }
      ... on MutationError { message }
    }
  }
`;

export const SENT_POSTS_QUERY = /* GraphQL */ `
  query SentPosts($org: OrganizationId!, $channelIds: [ChannelId!], $after: String) {
    posts(first: 50, after: $after, input: {
      organizationId: $org
      filter: { status: [sent], channelIds: $channelIds }
      sort: [{ field: createdAt, direction: desc }]
    }) {
      edges { cursor node { id text sentAt channelId channelService externalLink } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const TAGS_QUERY = /* GraphQL */ `
  query Tags($org: OrganizationId!) {
    tagsV2(first: 100, input: { organizationId: $org }) {
      edges { node { id name color colorName isLocked } }
      pageInfo { hasNextPage endCursor }
      totalCount
    }
  }
`;

export const CREATE_TAG_MUTATION = /* GraphQL */ `
  mutation CreateTag($org: OrganizationId!, $name: String!, $color: String!) {
    createTag(input: { organizationId: $org, tag: { name: $name, color: $color } }) {
      ... on TagActionSuccess { tag { id name color colorName } }
      ... on DuplicateError { message }
      ... on LimitReachedError { message }
      ... on MutationError { message }
    }
  }
`;

export type BufferOrganization = {
  id: string;
  name: string;
  channelCount: number;
  limits: { channels: number; tags: number; scheduledPosts: number };
};

export type AccountResult = {
  account: {
    id: string;
    email: string | null;
    name: string | null;
    avatar: string | null;
    timezone: string | null;
    organizations: BufferOrganization[];
  };
};

export type BufferChannel = CachedChannel;

export type ChannelsResult = { channels: BufferChannel[] };

export type CreatePostResult = {
  createPost:
    | { post: { id: string; text: string | null; status: string; dueAt: string | null; channelId: string; shareMode: string } }
    | { message: string };
};

export type SentPostsResult = {
  posts: {
    edges: { cursor: string; node: { id: string; text: string | null; sentAt: string | null; channelId: string; channelService: string; externalLink: string | null } }[] | null;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type Tag = { id: string; name: string; color: string; colorName: string | null; isLocked: boolean };
export type TagsResult = {
  tagsV2: { edges: { node: Tag }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null }; totalCount: number };
};

export type CreateTagResult = {
  createTag: { tag: Omit<Tag, "isLocked"> } | { message: string };
};
