/* eslint-disable no-restricted-properties */
import { Vercel } from "@vercel/sdk";

if (!process.env.VERCEL_TOKEN) {
  console.error("❌ VERCEL_TOKEN environment variable is required");
  process.exit(1);
}

const vercel = new Vercel({
  bearerToken: process.env.VERCEL_TOKEN,
});

const TEAM_ID = process.env.VERCEL_TEAM_ID;

if (!TEAM_ID) {
  console.error("❌ VERCEL_TEAM_ID environment variable is required");
  process.exit(1);
}

const GIT_ORG = process.env.VERCEL_GIT_ORG ?? "epicurerobotics";
const GIT_REPO = process.env.VERCEL_GIT_REPO ?? "helper-epicure";

async function getAllEpicureProjects() {
  try {
    console.log("Fetching all projects...");
    const response = await vercel.projects.getProjects({
      teamId: TEAM_ID,
      limit: "100",
      search: "epicure-",
    });

    const instances = response.projects.filter((project) => project.name.startsWith("epicure-") && !project.link);

    console.log(`Found ${instances.length} projects with "epicure-" prefix.`);

    return instances;
  } catch (error) {
    console.error("Error fetching projects:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function deployProject(projectName: string, projectId: string) {
  try {
    const createResponse = await vercel.deployments.createDeployment({
      teamId: TEAM_ID,
      requestBody: {
        name: projectName,
        target: "production",
        gitSource: {
          type: "github",
          repo: GIT_REPO,
          ref: "main",
          org: GIT_ORG,
        },
      },
    });

    console.log(`✅ Deployment created for ${projectId}: ID ${createResponse.id} with status ${createResponse.status}`);

    return {
      projectId,
      deploymentId: createResponse.id,
      status: createResponse.status,
      success: true,
    };
  } catch (error) {
    console.error(`❌ Error deploying ${projectId}:`, error instanceof Error ? error.message : String(error));
    return {
      projectId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deployAllEpicureProjects() {
  console.log("🚀 Starting deployment of Epicure Vercel projects...\n");

  const projects = await getAllEpicureProjects();

  if (projects.length === 0) {
    console.log("No projects with 'epicure-' prefix found. Exiting.");
    return;
  }

  console.log("\n📦 Starting deployments...");

  const results = await Promise.all(projects.map((project) => deployProject(project.name, project.id)));

  console.log("\n📊 Deployment Summary:");
  console.log("======================");

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Successful deployments: ${successful.length}`);
  successful.forEach((result) => {
    console.log(`  - ${result.projectId} (${result.deploymentId})`);
  });

  if (failed.length > 0) {
    console.log(`❌ Failed deployments: ${failed.length}`);
    failed.forEach((result) => {
      console.log(`  - ${result.projectId}: ${result.error}`);
    });
  }

  console.log(`\n🎉 Deployment process completed!`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

deployAllEpicureProjects();
