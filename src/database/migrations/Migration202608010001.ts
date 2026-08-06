import { Migration } from "@mikro-orm/migrations";

const tableColumns: Record<string, string[]> = {
  users: ["`login_id` varchar(20) not null", "`email` varchar(191) not null", "`password_hash` varchar(255) not null", "`name` varchar(50) not null", "`notification_enabled` tinyint(1) not null", "`free_story_used` tinyint(1) not null", "`deleted_at` datetime(3) null", "`deletion_reason` varchar(500) null"],
  refresh_sessions: ["`token_hash` varchar(64) not null", "`family_id` varchar(36) not null", "`expires_at` datetime(3) not null", "`revoked_at` datetime(3) null", "`replaced_by_id` varchar(36) null"],
  verification_records: ["`email` varchar(191) not null", "`purpose` varchar(40) not null", "`code_hash` varchar(64) null", "`token_hash` varchar(64) null", "`attempts` int not null", "`expires_at` datetime(3) not null", "`confirmed_at` datetime(3) null", "`used_at` datetime(3) null", "`payload` json null"],
  guest_sessions: ["`device_id` varchar(200) null", "`token_hash` varchar(64) not null", "`expires_at` datetime(3) not null", "`claimed_by_user_id` varchar(36) null"],
  consent_histories: ["`type` varchar(40) not null", "`version` varchar(30) null", "`agreed` tinyint(1) null", "`ip` varchar(64) null", "`agreed_at` datetime(3) null", "`revoked_at` datetime(3) null", "`assessment_id` varchar(36) null", "`overrides` json null"],
  children: ["`name` varchar(50) not null", "`birth_date` varchar(10) not null", "`gender` varchar(20) null", "`interests` json not null", "`pronouns` varchar(30) null", "`notes` text null", "`personality_profile` json null", "`anonymized_at` datetime(3) null"],
  personality_assessments: ["`child_id` varchar(36) not null", "`consent_version` varchar(30) not null", "`answers` json not null", "`scores` json null", "`raw_type` varchar(100) null", "`labels` json null", "`submitted_at` datetime(3) null"],
  story_drafts: ["`payload` json not null"],
  generation_jobs: ["`draft_id` varchar(36) not null", "`type` varchar(20) not null", "`stage` varchar(20) not null", "`progress` int not null", "`error_code` varchar(60) null", "`completed_at` datetime(3) null"],
  stories: ["`draft_id` varchar(36) not null", "`child_id` varchar(36) null", "`child_name` varchar(50) not null", "`title` varchar(100) not null", "`story_type` varchar(20) not null", "`cover_file_id` varchar(36) not null", "`cover_preview_file_id` varchar(36) not null", "`pages` json not null", "`parent_questions` json not null", "`order_id` varchar(36) not null", "`final_approved_at` datetime(3) null", "`deleted_at` datetime(3) null", "`file_destruction_scheduled_at` datetime(3) null"],
  credit_transactions: ["`amount` int not null", "`balance_after` int not null", "`type` varchar(30) not null", "`reference_id` varchar(36) null"],
  subscriptions: ["`plan_id` varchar(50) not null", "`started_at` datetime(3) not null", "`current_period_end` datetime(3) not null", "`cancel_at_period_end` tinyint(1) not null"],
  products: ["`name` varchar(100) not null", "`description` text null", "`price` int not null", "`subscriber_price` int null", "`options` json null", "`active` tinyint(1) not null"],
  cart_items: ["`product_id` varchar(50) not null", "`quantity` int not null", "`story_id` varchar(36) null", "`options` json null"],
  orders: ["`items` json not null", "`amount` int not null", "`payment_status` varchar(30) not null", "`order_status` varchar(30) not null", "`shipping` json null", "`gift` json null", "`gift_message` varchar(500) null", "`carrier` varchar(80) null", "`tracking_number` varchar(100) null", "`tracking_url` varchar(500) null"],
  gifts: ["`order_id` varchar(36) not null", "`code_hash` varchar(64) not null", "`message` varchar(500) null", "`expires_at` datetime(3) not null"],
  reports: ["`draft_id` varchar(36) null", "`story_id` varchar(36) null", "`category` varchar(50) not null", "`description` text not null"],
  b2b_inquiries: ["`organization_name` varchar(100) not null", "`contact_name` varchar(50) not null", "`email` varchar(191) not null", "`phone` varchar(30) not null", "`organization_type` varchar(50) not null", "`estimated_volume` int not null", "`message` text not null", "`privacy_consent` tinyint(1) not null"],
  stored_files: ["`kind` varchar(40) not null", "`local_path` varchar(1000) not null", "`mime_type` varchar(100) not null", "`size` int not null", "`expires_at` datetime(3) null", "`deleted_at` datetime(3) null"],
  data_exports: ["`file_id` varchar(36) null", "`expires_at` datetime(3) null", "`error_code` varchar(60) null"],
};

export class Migration202608010001 extends Migration {
  override up(): void {
    for (const [table, columns] of Object.entries(tableColumns)) {
      this.addSql(`create table \`${table}\` (
        \`id\` varchar(36) not null,
        \`owner_id\` varchar(36) null,
        \`guest_id\` varchar(36) null,
        \`relation_id\` varchar(36) null,
        \`status\` varchar(40) null,
        \`lookup1\` varchar(191) null,
        \`lookup2\` varchar(191) null,
        ${columns.join(",\n        ")},
        \`created_at\` datetime(3) not null,
        \`updated_at\` datetime(3) not null,
        primary key (\`id\`),
        index \`${table}_owner_idx\` (\`owner_id\`), index \`${table}_guest_idx\` (\`guest_id\`),
        index \`${table}_relation_idx\` (\`relation_id\`), index \`${table}_status_idx\` (\`status\`),
        index \`${table}_lookup1_idx\` (\`lookup1\`), index \`${table}_lookup2_idx\` (\`lookup2\`)
      ) default character set utf8mb4 collate utf8mb4_unicode_ci engine = InnoDB;`);
    }
    this.addSql("alter table `users` add unique `users_login_id_unique` (`lookup1`), add unique `users_email_unique` (`lookup2`);");
    this.addSql("alter table `gifts` add unique `gifts_code_unique` (`lookup1`);");
  }

  override down(): void {
    for (const table of Object.keys(tableColumns).reverse()) this.addSql(`drop table if exists \`${table}\`;`);
  }
}

