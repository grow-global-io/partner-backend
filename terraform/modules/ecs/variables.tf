variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "ecr_repository_url" {
  description = "URL of the ECR repository"
  type        = string
}

variable "container_port" {
  description = "Port the container exposes"
  type        = number
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "public_subnets" {
  description = "IDs of public subnets"
  type        = list(string)
}

variable "private_subnets" {
  description = "IDs of private subnets"
  type        = list(string)
}

variable "app_count" {
  description = "Number of container instances to run"
  type        = number
}

variable "cpu" {
  description = "CPU units for the ECS task"
  type        = string
}

variable "memory" {
  description = "Memory for the ECS task"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "alb_security_group" {
  description = "Security group ID for the ALB"
  type        = string
}

variable "ecs_tasks_security_group" {
  description = "Security group ID for ECS tasks"
  type        = string
}

variable "mongodb_uri" {
  description = "MongoDB connection URI"
  type        = string
  sensitive   = true
}

variable "node_env" {
  description = "Node environment (production, development)"
  type        = string
}

variable "aws_s3_bucket" {
  description = "S3 bucket name for file uploads"
  type        = string
}

variable "openai_api_key" {
  description = "OpenAI API Key"
  type        = string
  sensitive   = true
}

variable "telegram_token" {
  description = "Telegram Bot Token"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT Secret Key"
  type        = string
  sensitive   = true
}
