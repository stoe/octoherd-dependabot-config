import {composeCreatePullRequest} from 'octokit-plugin-create-pull-request'
import {readFileSync} from 'fs'
import {resolve} from 'path'

const pkg = JSON.parse(readFileSync('./package.json'))

/**
 * @param {import('@octoherd/cli').Octokit} octokit
 * @param {import('@octoherd/cli').Repository} repository
 * @param { {dryRun: boolean} } options Custom user options passed to the CLI
 */
export async function script(octokit, repository, {dryRun = false}) {
  if (repository.archived) {
    octokit.log.info({change: false}, `repository archived`)
    return
  }

  if (repository.fork) {
    octokit.log.info({change: false}, `repository is a fork`)
    return
  }

  if (repository.size === 0) {
    octokit.log.info({change: false, size: repository.size}, `repository is empty`)
    return
  }

  const {
    owner: {login: owner},
    name: repo,
    html_url
  } = repository

  const language = repository.language ? repository.language.toLowerCase() : null

  let configPath = undefined
  switch (language) {
    case 'javascript':
    case 'go':
      configPath = resolve(`./dependabot.${language}.yml`)
      break
    case 'hcl':
      configPath = resolve(`./dependabot.terraform.yml`)
      break
    default:
      configPath = resolve(`./dependabot.default.yml`)
      break
  }

  const newContent = readFileSync(configPath)

  const payload = {
    message: 'Add dependabot config',
    content: newContent.toString('base64')
  }

  try {
    const {
      data: {content}
    } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: '.github/dependabot.yml'
    })
    const buf = Buffer.from(content, 'base64')

    if (buf.toString('utf-8') === newContent.toString('utf-8')) {
      octokit.log.info({change: false}, `${html_url} no change`)
      return
    }

    // eslint-disable-next-line i18n-text/no-en
    payload.message = 'Update dependabot config'
  } catch (error) {
    // do nothing
  }

  if (dryRun) {
    octokit.log.info({change: false, payload}, `[dry run] would update ${html_url}`)
    return
  }

  try {
    const {data: pr} = await composeCreatePullRequest(octokit, {
      owner,
      repo,
      title: payload.message,
      body: `via [${pkg.name}](${pkg.repository})`,
      base: 'main',
      head: 'dependabot-config',
      changes: [
        {
          files: {
            '.github/dependabot.yml': {
              encoding: 'base64',
              content: payload.content
            }
          },
          commit: `🤖 ${payload.message}`,
          emptyCommit: false
        }
      ],
      createWhenEmpty: false
    })
    octokit.log.info({change: true}, `pull request created ${pr.html_url}`)
  } catch (error) {
    octokit.log.error(`${error.message}`)
  }
}

export default script
