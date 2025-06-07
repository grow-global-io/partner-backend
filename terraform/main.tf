provider "aws" {
  region = var.aws_region
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket = "growlimitless-tfstate"
    key    = "partner-backend/terraform.tfstate"
    region = "us-east-1"
  }
}

# VPC and Networking
module "vpc" {
  source = "./modules/vpc"
  
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  project_name         = var.project_name
  environment          = var.environment
}

# Database (MongoDB Atlas)
# Note: If using MongoDB Atlas, you might want to use their Terraform provider
# This is a placeholder for demonstration
resource "aws_ssm_parameter" "mongodb_connection" {
  name        = "/${var.project_name}/${var.environment}/mongodb-uri"
  description = "MongoDB Connection URI"
  type        = "SecureString"
  value       = var.mongodb_uri
}

# ECR Repository
resource "aws_ecr_repository" "app_ecr_repo" {
  name                 = "${var.project_name}-${var.environment}"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
}

# ECS Cluster and Service
module "ecs" {
  source = "./modules/ecs"
  
  project_name    = var.project_name
  environment     = var.environment
  ecr_repository_url = aws_ecr_repository.app_ecr_repo.repository_url
  container_port  = var.container_port
  vpc_id          = module.vpc.vpc_id
  public_subnets  = module.vpc.public_subnets
  private_subnets = module.vpc.private_subnets
  app_count       = var.app_count
  cpu             = var.cpu
  memory          = var.memory
  region          = var.aws_region
  mongodb_uri     = var.mongodb_uri
  node_env        = var.node_env
  aws_s3_bucket   = var.aws_s3_bucket
  openai_api_key  = var.openai_api_key
  telegram_token  = var.telegram_token
  jwt_secret      = var.jwt_secret
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "app_log_group" {
  name              = "/ecs/${var.project_name}-${var.environment}"
  retention_in_days = 30
}

# S3 bucket for file uploads
resource "aws_s3_bucket" "file_uploads" {
  bucket = var.aws_s3_bucket
  
  tags = {
    Name        = "${var.project_name}-uploads"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "file_uploads_block" {
  bucket = aws_s3_bucket.file_uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
