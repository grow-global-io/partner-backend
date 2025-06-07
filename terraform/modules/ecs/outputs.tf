output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "service_name" {
  value = aws_ecs_service.app.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.app.arn
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_arn" {
  value = aws_lb.main.arn
}

output "cloudwatch_log_group_name" {
  value = aws_cloudwatch_log_group.app.name
}

output "task_role_arn" {
  value = aws_iam_role.ecs_task.arn
}

output "execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}
