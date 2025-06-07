variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "growlimitless-partner"
}

variable "environment" {
  description = "Deployment environment (e.g., dev, staging, production)"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to use"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.3.0/24", "10.0.4.0/24"]
}

variable "container_port" {
  description = "Port the container exposes"
  type        = number
  default     = 8000
}

variable "app_count" {
  description = "Number of container instances to run"
  type        = number
  default     = 2
}

variable "cpu" {
  description = "CPU units for the ECS task"
  type        = string
  default     = "256"
}

variable "memory" {
  description = "Memory for the ECS task"
  type        = string
  default     = "512"
}

# Sensitive variables that should be passed from GitHub Actions secrets
variable "mongodb_uri" {
  description = "MongoDB connection URI"
  type        = string
  sensitive   = true
}

variable "node_env" {
  description = "Node environment (production, development)"
  type        = string
  default     = "production"
}

variable "aws_s3_bucket" {
  description = "S3 bucket name for file uploads"
  type        = string
  default     = "growlimitless-partner-uploads"
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
